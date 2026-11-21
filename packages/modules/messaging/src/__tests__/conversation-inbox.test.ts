import { DATING_DAYS } from '@tamgiao/contracts/constants';
import { FakeClock, addDuration, newId, type Tx } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GetIcebreakers,
  ListMyConversations,
  MarkConversationRead,
} from '../application/conversation-inbox.js';
import {
  CloseConversationForMatch,
  OpenConversationForMatch,
} from '../application/conversation-lifecycle.js';
import { SendMessage } from '../application/send-message.js';
import type { MessageScreener } from '../domain/message-policy.js';
import {
  InMemoryConversationReadRepository,
  InMemoryConversationRepository,
  InMemoryMessageRepository,
  PassThroughUnitOfWork,
} from './messaging-fakes.js';

const T0 = new Date('2026-06-01T08:00:00.000Z');
const A = newId<'User'>();
const B = newId<'User'>();
const C = newId<'User'>();
const OUTSIDER = newId<'User'>();

/** Che "zalo…", gắn cờ "chuyển khoản" (→ FRAUD_WARNING chỉ người nhận thấy). */
const screener: MessageScreener = (body) => {
  const flagged = body.includes('chuyển khoản');
  return {
    maskedBody: body.includes('zalo') ? body.replace(/zalo\S*/g, '***') : null,
    flagged,
    reasons: flagged ? ['BANK_TRANSFER'] : [],
  };
};

let clock: FakeClock;
let conversations: InMemoryConversationRepository;
let messages: InMemoryMessageRepository;
let reads: InMemoryConversationReadRepository;
const deps = () => ({ uow: new PassThroughUnitOfWork(), clock, conversations, messages, reads });

async function openConversation(a: string, b: string, at = T0): Promise<{ id: string; matchId: string }> {
  const matchId = newId();
  await new OpenConversationForMatch({ clock, conversations, messages }).handle({} as Tx, {
    matchId,
    participantIds: [a, b],
    openedAt: at,
    closesAt: addDuration(at, { days: DATING_DAYS }),
  });
  const state = [...conversations.states.values()].find((s) => s.matchId === matchId);
  if (!state) throw new Error('chưa mở hội thoại');
  return { id: state.id, matchId };
}

async function send(conversationId: string, senderId: string, body: string): Promise<string> {
  clock.advance({ seconds: 1 });
  const r = await new SendMessage({
    uow: new PassThroughUnitOfWork(),
    clock,
    conversations,
    messages,
    screener,
  }).execute({ conversationId, senderId, body });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value.messageId;
}

beforeEach(() => {
  clock = new FakeClock(T0);
  conversations = new InMemoryConversationRepository();
  messages = new InMemoryMessageRepository();
  reads = new InMemoryConversationReadRepository();
});

describe('ListMyConversations', () => {
  it('tin cuối theo người xem (bản che cho người nhận), số chưa đọc, ngày X/DATING_DAYS', async () => {
    const { id } = await openConversation(A, B);
    await send(id, A, 'chào em');
    const last = await send(id, A, 'zalo.me/abc nhé');
    clock.set(addDuration(T0, { days: 2, hours: 1 }));

    const forB = (await new ListMyConversations(deps()).execute({ userId: B })).unwrapOr([]);
    expect(forB).toHaveLength(1);
    expect(forB[0]).toMatchObject({
      conversationId: id,
      peerUserId: A,
      status: 'OPEN',
      datingDay: 3,
      datingDays: DATING_DAYS,
      lastMessage: { messageId: last, body: '*** nhé', masked: true, clientMessageId: null },
      // tin hệ thống mở hội thoại + 2 tin của A
      unreadCount: 3,
      lastReadMessageId: null,
    });
    const forA = (await new ListMyConversations(deps()).execute({ userId: A.toUpperCase() })).unwrapOr([]);
    expect(forA[0]).toMatchObject({
      peerUserId: B,
      lastMessage: { body: 'zalo.me/abc nhé', masked: false },
      // chỉ tin hệ thống (tin của chính mình không tính)
      unreadCount: 1,
    });
  });

  it('FRAUD_WARNING chỉ là tin cuối / chưa đọc của người nhận', async () => {
    const { id } = await openConversation(A, B);
    await send(id, A, 'chuyển khoản giúp anh');
    const forA = (await new ListMyConversations(deps()).execute({ userId: A })).unwrapOr([]);
    const forB = (await new ListMyConversations(deps()).execute({ userId: B })).unwrapOr([]);
    expect(forA[0]?.lastMessage).toMatchObject({ kind: 'TEXT', body: 'chuyển khoản giúp anh' });
    expect(forA[0]?.unreadCount).toBe(1);
    expect(forB[0]?.lastMessage).toMatchObject({ kind: 'SYSTEM', systemCode: 'FRAUD_WARNING' });
    expect(forB[0]?.unreadCount).toBe(3);
  });

  it('gồm cả hội thoại đã đóng; hoạt động gần nhất trước; người ngoài → danh sách rỗng', async () => {
    const old = await openConversation(A, C);
    await new CloseConversationForMatch({ clock, conversations, messages }).handle({} as Tx, {
      matchId: old.matchId,
      reason: 'MATCH_CLOSED',
      fromStatus: 'DATING',
      participantIds: [A, C],
      closedAt: clock.now(),
    });
    clock.advance({ days: 1 });
    const current = await openConversation(A, B, clock.now());
    await send(current.id, B, 'hi');

    const list = (await new ListMyConversations(deps()).execute({ userId: A })).unwrapOr([]);
    expect(list.map((c) => [c.conversationId, c.status])).toEqual([
      [current.id, 'OPEN'],
      [old.id, 'CLOSED'],
    ]);
    expect(list[1]?.lastMessage).toMatchObject({ systemCode: 'CONVERSATION_CLOSED' });
    expect(await new ListMyConversations(deps()).execute({ userId: OUTSIDER })).toMatchObject({ value: [] });
  });
});

describe('MarkConversationRead', () => {
  it('lưu con trỏ, số chưa đọc giảm; đánh dấu tin cũ hơn → không lùi, advanced=false', async () => {
    const { id } = await openConversation(A, B);
    const m1 = await send(id, A, 'tin 1');
    const m2 = await send(id, A, 'tin 2');
    await send(id, A, 'tin 3');
    const mark = new MarkConversationRead(deps());

    const r2 = (await mark.execute({ conversationId: id, userId: B, messageId: m2 })).unwrapOr(
      undefined as never,
    );
    expect(r2).toMatchObject({ readerId: B, lastReadMessageId: m2, advanced: true, unreadCount: 1 });
    expect(r2.readAt).toEqual(clock.now());

    const r1 = (await mark.execute({ conversationId: id, userId: B, messageId: m1 })).unwrapOr(
      undefined as never,
    );
    expect(r1).toMatchObject({ lastReadMessageId: m2, advanced: false, unreadCount: 1 });

    const list = (await new ListMyConversations(deps()).execute({ userId: B })).unwrapOr([]);
    expect(list[0]).toMatchObject({ lastReadMessageId: m2, unreadCount: 1 });
  });

  it('AC2: người ngoài → NOT_PARTICIPANT; hội thoại không có → NOT_FOUND; id sai → INVALID_ID', async () => {
    const { id } = await openConversation(A, B);
    const m = await send(id, A, 'tin');
    const mark = new MarkConversationRead(deps());
    expect(await mark.execute({ conversationId: id, userId: OUTSIDER, messageId: m })).toMatchObject({
      error: { code: 'NOT_PARTICIPANT' },
    });
    expect(await mark.execute({ conversationId: newId(), userId: A, messageId: m })).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
    expect(await mark.execute({ conversationId: id, userId: A, messageId: 'x' })).toMatchObject({
      error: { code: 'INVALID_ID' },
    });
  });

  it('tin không thuộc hội thoại / tin riêng của người kia → NOT_FOUND (field messageId)', async () => {
    const { id } = await openConversation(A, B);
    const other = await openConversation(C, OUTSIDER);
    const foreign = await send(other.id, C, 'tin cặp khác');
    await send(id, A, 'chuyển khoản giúp anh');
    const warning = messages.states.find((m) => m.systemCode === 'FRAUD_WARNING');
    if (!warning) throw new Error('thiếu FRAUD_WARNING');
    const mark = new MarkConversationRead(deps());
    for (const messageId of [foreign, warning.id, newId()]) {
      expect(await mark.execute({ conversationId: id, userId: A, messageId })).toMatchObject({
        error: { code: 'NOT_FOUND', details: { field: 'messageId' } },
      });
    }
    expect(await mark.execute({ conversationId: id, userId: B, messageId: warning.id })).toMatchObject({
      value: { advanced: true, unreadCount: 0 },
    });
  });
});

describe('GetIcebreakers', () => {
  it('chọn chặng theo ngày tìm hiểu; người ngoài → NOT_PARTICIPANT', async () => {
    const { id } = await openConversation(A, B);
    const get = new GetIcebreakers(deps());
    expect(await get.execute({ conversationId: id, userId: A })).toMatchObject({
      value: { conversationId: id, datingDay: 1, datingDays: DATING_DAYS, theme: 'Làm quen' },
    });
    clock.set(addDuration(T0, { days: 8 }));
    const deep = (await get.execute({ conversationId: id, userId: B })).unwrapOr(undefined as never);
    expect(deep).toMatchObject({ datingDay: 9, theme: 'Chủ đề sâu' });
    expect(deep.topics.length).toBeGreaterThan(0);
    expect(await get.execute({ conversationId: id, userId: OUTSIDER })).toMatchObject({
      error: { code: 'NOT_PARTICIPANT' },
    });
  });
});
