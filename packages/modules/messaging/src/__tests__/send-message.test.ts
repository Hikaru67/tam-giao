import { MESSAGE_RATE_LIMIT_PER_MINUTE } from '@tamgiao/contracts/constants';
import { FakeClock, addDuration, newId, type Tx } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CloseConversationForMatch,
  OpenConversationForMatch,
} from '../application/conversation-lifecycle.js';
import { SendMessage } from '../application/send-message.js';
import type { ConversationId } from '../domain/conversation.js';
import type { MessageScreener } from '../domain/message-policy.js';
import { CONTACT_MASK_LABELS } from '../domain/contact-masker.js';
import { createContentScreener } from '../domain/message-screener.js';
import {
  InMemoryConversationRepository,
  InMemoryMessageRepository,
  PassThroughUnitOfWork,
} from './messaging-fakes.js';

const T0 = new Date('2026-06-01T08:00:00.000Z');
const CLOSES = addDuration(T0, { days: 14 });
const A = newId<'User'>();
const B = newId<'User'>();
const OUTSIDER = newId<'User'>();
const TX = {} as Tx;

let clock: FakeClock;
let uow: PassThroughUnitOfWork;
let conversations: InMemoryConversationRepository;
let messages: InMemoryMessageRepository;
let matchId: string;

const lifecycle = () => ({ clock, conversations, messages });
const sendMessage = (screener?: MessageScreener) =>
  new SendMessage({ uow, clock, conversations, messages, ...(screener ? { screener } : {}) });

async function openConversation(): Promise<ConversationId> {
  await new OpenConversationForMatch(lifecycle()).handle(TX, {
    matchId,
    participantIds: [A, B],
    openedAt: T0,
    closesAt: CLOSES,
  });
  const [state] = [...conversations.states.values()];
  if (!state) throw new Error('chưa mở hội thoại');
  return state.id;
}

beforeEach(() => {
  clock = new FakeClock(T0);
  uow = new PassThroughUnitOfWork();
  conversations = new InMemoryConversationRepository();
  messages = new InMemoryMessageRepository();
  matchId = newId<'Match'>();
});

describe('SendMessage', () => {
  it('participant gửi tin khi OPEN → lưu tin + MessageSent cho người còn lại', async () => {
    const id = await openConversation();
    clock.advance({ minutes: 5 });
    const r = await sendMessage().execute({
      conversationId: id,
      senderId: A.toUpperCase(),
      body: ' Chào em ',
    });
    expect(r.isOk()).toBe(true);
    expect(r.unwrapOr(undefined as never)).toMatchObject({
      conversationId: id,
      senderId: A,
      kind: 'TEXT',
      body: 'Chào em',
      maskedBody: null,
      flagged: false,
      sentAt: clock.now(),
    });
    const sent = messages.events.filter((e) => e.type === 'MessageSent').at(-1);
    expect(sent?.payload).toMatchObject({ senderId: A, recipientIds: [B], kind: 'TEXT' });
  });

  it('AC1: gửi vào hội thoại CLOSED → CONVERSATION_CLOSED, không lưu tin', async () => {
    const id = await openConversation();
    await new CloseConversationForMatch(lifecycle()).handle(TX, {
      matchId,
      participantIds: [A, B],
      fromStatus: 'DATING',
      reason: 'MATCH_LOCKED',
      closedAt: T0,
    });
    const before = messages.states.length;
    const r = await sendMessage().execute({ conversationId: id, senderId: B, body: 'còn đó không?' });
    expect(r).toMatchObject({ error: { code: 'CONVERSATION_CLOSED', details: { reason: 'CLOSED' } } });
    expect(messages.states).toHaveLength(before);
  });

  it('đã qua closesAt (event đóng match chưa tới) → CONVERSATION_CLOSED{PERIOD_ENDED}', async () => {
    const id = await openConversation();
    clock.set(CLOSES);
    const r = await sendMessage().execute({ conversationId: id, senderId: A, body: 'hi' });
    expect(r).toMatchObject({ error: { code: 'CONVERSATION_CLOSED', details: { reason: 'PERIOD_ENDED' } } });
  });

  it('người ngoài cặp → NOT_PARTICIPANT', async () => {
    const id = await openConversation();
    const r = await sendMessage().execute({ conversationId: id, senderId: OUTSIDER, body: 'hi' });
    expect(r).toMatchObject({ error: { code: 'NOT_PARTICIPANT' } });
  });

  it('hội thoại không tồn tại → NOT_FOUND; id sai dạng → INVALID_ID (không mở transaction)', async () => {
    const send = sendMessage();
    expect(await send.execute({ conversationId: newId(), senderId: A, body: 'hi' })).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
    const runs = uow.runs;
    expect(await send.execute({ conversationId: 'abc', senderId: A, body: 'hi' })).toMatchObject({
      error: { code: 'INVALID_ID' },
    });
    expect(uow.runs).toBe(runs);
  });

  it('nội dung rỗng / quá dài → lỗi trước khi chạm DB', async () => {
    const id = await openConversation();
    const send = sendMessage();
    expect(await send.execute({ conversationId: id, senderId: A, body: '   ' })).toMatchObject({
      error: { code: 'MESSAGE_EMPTY' },
    });
    expect(await send.execute({ conversationId: id, senderId: A, body: 'a'.repeat(2_001) })).toMatchObject({
      error: { code: 'MESSAGE_TOO_LONG' },
    });
    expect(uow.runs).toBe(0);
  });

  it(`rate limit: tin thứ ${MESSAGE_RATE_LIMIT_PER_MINUTE + 1} trong 60 giây → RATE_LIMITED; hết cửa sổ gửi lại được`, async () => {
    const id = await openConversation();
    const send = sendMessage();
    const start = clock.now();
    for (let i = 0; i < MESSAGE_RATE_LIMIT_PER_MINUTE; i += 1) {
      clock.set(addDuration(start, { seconds: i }));
      const r = await send.execute({ conversationId: id, senderId: A, body: `tin ${i}` });
      expect(r.isOk()).toBe(true);
    }
    expect(await send.execute({ conversationId: id, senderId: A, body: 'quá nhanh' })).toMatchObject({
      error: { code: 'RATE_LIMITED', details: { limit: MESSAGE_RATE_LIMIT_PER_MINUTE } },
    });
    // Người kia không bị ảnh hưởng (đếm theo người gửi).
    expect((await send.execute({ conversationId: id, senderId: B, body: 'chào' })).isOk()).toBe(true);
    // Tin đầu tiên (giây 0) rời cửa sổ khi now = start + 60s (cửa sổ (now − 60s, now]).
    clock.set(addDuration(start, { seconds: 60 }));
    expect((await send.execute({ conversationId: id, senderId: A, body: 'lại được' })).isOk()).toBe(true);
  });

  it('screener (điểm cắm BE-S6-03): gắn cờ → maskedBody + MessageFlagged', async () => {
    const id = await openConversation();
    const screener: MessageScreener = (body) => ({
      maskedBody: body.replace(/\d/g, '*'),
      flagged: true,
      reasons: ['PHONE_NUMBER'],
    });
    const r = await sendMessage(screener).execute({ conversationId: id, senderId: A, body: 'số mình 0912' });
    expect(r.unwrapOr(undefined as never)).toMatchObject({
      body: 'số mình 0912',
      maskedBody: 'số mình ****',
      flagged: true,
    });
    // + tin hệ thống FRAUD_WARNING cho người nhận (BE-S6-03).
    expect(messages.events.slice(-3).map((e) => e.type)).toEqual([
      'MessageSent',
      'MessageFlagged',
      'MessageSent',
    ]);
  });

  describe('bộ lọc thật (BE-S6-03)', () => {
    it('tin lừa đảo → flagged + MessageFlagged (mã luật, không nội dung) + FRAUD_WARNING chỉ người nhận thấy', async () => {
      const id = await openConversation();
      const text =
        'Anh đầu tư Bitcoin trên sàn Binance, lãi 30% mỗi tuần, chuyển khoản 5 triệu vào STK 0123456789';
      const r = await sendMessage(createContentScreener()).execute({
        conversationId: id,
        senderId: A,
        body: text,
      });
      const view = r.unwrapOr(undefined as never);
      expect(view).toMatchObject({ body: text, flagged: true });
      expect(view.maskedBody).toContain(CONTACT_MASK_LABELS.PHONE);

      const [flaggedMsg, warning] = messages.states.slice(-2);
      expect(flaggedMsg).toMatchObject({ senderId: A, flagged: true, visibleTo: null });
      expect(flaggedMsg?.flagReasons).toEqual(
        expect.arrayContaining(['CRYPTO', 'INVESTMENT', 'MONEY_TRANSFER']),
      );
      expect(warning).toMatchObject({
        kind: 'SYSTEM',
        systemCode: 'FRAUD_WARNING',
        senderId: null,
        visibleTo: B,
      });

      const events = messages.events.slice(-3);
      expect(events.map((e) => e.type)).toEqual(['MessageSent', 'MessageFlagged', 'MessageSent']);
      expect(events[1]?.payload).toMatchObject({ senderId: A, reasons: flaggedMsg?.flagReasons });
      expect(events[2]?.payload).toMatchObject({ systemCode: 'FRAUD_WARNING', recipientIds: [B] });
      expect(JSON.stringify(events)).not.toContain('Bitcoin');
    });

    it('tin bình thường có SĐT → che cho người nhận, không gắn cờ, không cảnh báo', async () => {
      const id = await openConversation();
      const before = messages.states.length;
      const r = await sendMessage(createContentScreener()).execute({
        conversationId: id,
        senderId: A,
        body: 'zalo: 0912345678',
      });
      expect(r.unwrapOr(undefined as never)).toMatchObject({
        body: 'zalo: 0912345678',
        maskedBody: `zalo: ${CONTACT_MASK_LABELS.PHONE}`,
        flagged: false,
      });
      expect(messages.states).toHaveLength(before + 1);
      expect(messages.events.at(-1)?.type).toBe('MessageSent');
    });
  });
});
