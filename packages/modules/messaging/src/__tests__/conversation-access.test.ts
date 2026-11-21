import { FakeClock, addDuration, newId, type Tx } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { JoinConversation, ListMessages } from '../application/conversation-access.js';
import { OpenConversationForMatch } from '../application/conversation-lifecycle.js';
import { SendMessage } from '../application/send-message.js';
import type { RealtimeMessage } from '../application/ports/message-broadcaster.js';
import { Message } from '../domain/message.js';
import { realtimeFromSent, toMessageDto } from '../presentation/message-dto-mapper.js';
import {
  InMemoryConversationRepository,
  InMemoryMessageRepository,
  PassThroughUnitOfWork,
} from './messaging-fakes.js';

const T0 = new Date('2026-06-01T08:00:00.000Z');
const A = newId<'User'>();
const B = newId<'User'>();
const OUTSIDER = newId<'User'>();

let clock: FakeClock;
let conversations: InMemoryConversationRepository;
let messages: InMemoryMessageRepository;
let conversationId: string;
const deps = () => ({ uow: new PassThroughUnitOfWork(), conversations, messages });

beforeEach(async () => {
  clock = new FakeClock(T0);
  conversations = new InMemoryConversationRepository();
  messages = new InMemoryMessageRepository();
  await new OpenConversationForMatch({ clock, conversations, messages }).handle({} as Tx, {
    matchId: newId(),
    participantIds: [A, B],
    openedAt: T0,
    closesAt: addDuration(T0, { days: 14 }),
  });
  const [state] = [...conversations.states.values()];
  if (!state) throw new Error('chưa mở hội thoại');
  conversationId = state.id;
});

describe('JoinConversation', () => {
  it('participant (không phân biệt hoa thường) → OPEN', async () => {
    const r = await new JoinConversation(deps()).execute({ conversationId, userId: B.toUpperCase() });
    expect(r.unwrapOr(undefined as never)).toMatchObject({ conversationId, status: 'OPEN' });
  });

  it.each([
    ['người ngoài', () => ({ conversationId, userId: OUTSIDER }), 'NOT_PARTICIPANT'],
    ['không tồn tại', () => ({ conversationId: newId(), userId: A }), 'NOT_FOUND'],
    ['id sai', () => ({ conversationId: 'x', userId: A }), 'INVALID_ID'],
  ])('%s → %s', async (_name, cmd, code) => {
    expect(await new JoinConversation(deps()).execute(cmd())).toMatchObject({ error: { code } });
  });
});

const nth = (xs: readonly string[], i: number): string => {
  const x = xs[i];
  if (x === undefined) throw new Error(`thiếu phần tử ${i}`);
  return x;
};

describe('ListMessages', () => {
  async function sendMany(n: number): Promise<string[]> {
    const send = new SendMessage({ uow: new PassThroughUnitOfWork(), clock, conversations, messages });
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      clock.advance({ seconds: 1 });
      const r = await send.execute({ conversationId, senderId: i % 2 ? B : A, body: `tin ${i}` });
      ids.push(r.unwrapOr(undefined as never).messageId);
    }
    return ids;
  }

  it('sau `after` → các tin mới hơn, tăng dần, có hasMore theo limit', async () => {
    const ids = await sendMany(5);
    const list = new ListMessages(deps());
    const page = (await list.execute({ conversationId, userId: A, after: nth(ids, 1), limit: 2 })).unwrapOr(
      undefined as never,
    );
    expect(page.items.map((m) => m.messageId)).toEqual([ids[2], ids[3]]);
    expect(page.hasMore).toBe(true);
    const rest = (await list.execute({ conversationId, userId: B, after: nth(ids, 3), limit: 10 })).unwrapOr(
      undefined as never,
    );
    expect(rest).toMatchObject({ items: [{ messageId: ids[4] }], hasMore: false });
  });

  it('không con trỏ → `limit` tin mới nhất (tăng dần), hasMore = còn tin cũ hơn; limit bị kẹp trong 1…100', async () => {
    const ids = await sendMany(3);
    const list = new ListMessages(deps());
    const latest = (await list.execute({ conversationId, userId: A, limit: 2 })).unwrapOr(undefined as never);
    expect(latest.items.map((m) => m.messageId)).toEqual([ids[1], ids[2]]);
    expect(latest.hasMore).toBe(true);
    const one = (await list.execute({ conversationId, userId: A, limit: 0 })).unwrapOr(undefined as never);
    expect(one.items.map((m) => m.messageId)).toEqual([ids[2]]);
    const all = (await list.execute({ conversationId, userId: A, limit: 1000 })).unwrapOr(undefined as never);
    expect(all.items[0]).toMatchObject({ kind: 'SYSTEM', systemCode: 'CONVERSATION_OPENED', senderId: null });
    expect(all).toMatchObject({ hasMore: false });
  });

  it('`before` → các tin ngay trước con trỏ (tăng dần), cuộn lùi tới tin đầu', async () => {
    const ids = await sendMany(5);
    const list = new ListMessages(deps());
    const page = (await list.execute({ conversationId, userId: B, before: nth(ids, 3), limit: 2 })).unwrapOr(
      undefined as never,
    );
    expect(page.items.map((m) => m.messageId)).toEqual([ids[1], ids[2]]);
    expect(page.hasMore).toBe(true);
    const oldest = (
      await list.execute({ conversationId, userId: B, before: nth(ids, 1), limit: 10 })
    ).unwrapOr(undefined as never);
    expect(oldest.items.map((m) => m.systemCode ?? m.messageId)).toEqual(['CONVERSATION_OPENED', ids[0]]);
    expect(oldest.hasMore).toBe(false);
  });

  it('AC1: tin mới chen vào giữa hai lần cuộn lùi → không trùng, không sót', async () => {
    const ids = await sendMany(6);
    const list = new ListMessages(deps());
    const first = (await list.execute({ conversationId, userId: A, limit: 3 })).unwrapOr(undefined as never);
    expect(first.items.map((m) => m.messageId)).toEqual(ids.slice(3));
    const newer = await sendMany(4);
    const cursor = first.items[0]?.messageId;
    if (!cursor) throw new Error('trang rỗng');
    const second = (await list.execute({ conversationId, userId: A, before: cursor, limit: 3 })).unwrapOr(
      undefined as never,
    );
    expect(second.items.map((m) => m.messageId)).toEqual(ids.slice(0, 3));
    const caughtUp = (
      await list.execute({ conversationId, userId: A, after: nth(ids, 5), limit: 10 })
    ).unwrapOr(undefined as never);
    expect(caughtUp.items.map((m) => m.messageId)).toEqual(newer);
  });

  it('`after` và `before` cùng lúc → VALIDATION_FAILED', async () => {
    const id = nth(await sendMany(1), 0);
    const list = new ListMessages(deps());
    expect(await list.execute({ conversationId, userId: A, after: id, before: id, limit: 10 })).toMatchObject(
      { error: { code: 'VALIDATION_FAILED' } },
    );
  });

  it('tin FRAUD_WARNING (visibleTo người nhận) chỉ người nhận thấy; người gửi thấy body gốc, người nhận thấy bản che', async () => {
    const send = new SendMessage({
      uow: new PassThroughUnitOfWork(),
      clock,
      conversations,
      messages,
      screener: () => ({ maskedBody: 'chuyển khoản ***', flagged: true, reasons: ['BANK_TRANSFER'] }),
    });
    clock.advance({ seconds: 1 });
    const sent = (
      await send.execute({ conversationId, senderId: A, body: 'chuyển khoản 0123456789' })
    ).unwrapOr(undefined as never);
    expect(sent.systemMessages).toMatchObject([{ systemCode: 'FRAUD_WARNING', visibleTo: B }]);
    const list = new ListMessages(deps());
    const forA = (await list.execute({ conversationId, userId: A, limit: 10 })).unwrapOr(undefined as never);
    const forB = (await list.execute({ conversationId, userId: B, limit: 10 })).unwrapOr(undefined as never);
    expect(forA.items.map((m) => m.systemCode ?? m.body)).toEqual([
      'CONVERSATION_OPENED',
      'chuyển khoản 0123456789',
    ]);
    expect(forB.items.map((m) => m.systemCode ?? m.body)).toEqual([
      'CONVERSATION_OPENED',
      'chuyển khoản ***',
      'FRAUD_WARNING',
    ]);
    expect(forB.items[1]).toMatchObject({ masked: true, clientMessageId: null });
  });

  it('người ngoài → NOT_PARTICIPANT; after không phải UUID v7 → INVALID_ID', async () => {
    const list = new ListMessages(deps());
    expect(await list.execute({ conversationId, userId: OUTSIDER, limit: 10 })).toMatchObject({
      error: { code: 'NOT_PARTICIPANT' },
    });
    expect(await list.execute({ conversationId, userId: A, after: 'x', limit: 10 })).toMatchObject({
      error: { code: 'INVALID_ID' },
    });
    expect(await list.execute({ conversationId, userId: A, before: 'x', limit: 10 })).toMatchObject({
      error: { code: 'INVALID_ID' },
    });
  });
});

describe('toMessageDto — nội dung theo người xem', () => {
  const base: RealtimeMessage = {
    messageId: newId(),
    conversationId: newId(),
    senderId: A,
    kind: 'TEXT',
    systemCode: null,
    body: 'zalo 0912345678',
    maskedBody: 'zalo ***',
    clientMessageId: newId(),
    visibleTo: null,
    sentAt: T0.toISOString(),
  };

  it('khớp luật domain `Message.bodyFor` cho người gửi, người nhận, người khác', async () => {
    const send = new SendMessage({
      uow: new PassThroughUnitOfWork(),
      clock,
      conversations,
      messages,
      screener: () => ({ maskedBody: 'zalo ***', flagged: false, reasons: [] }),
    });
    const view = (
      await send.execute({ conversationId, senderId: A, body: 'zalo 0912345678', clientMessageId: newId() })
    ).unwrapOr(undefined as never);
    const state = messages.states.find((m) => m.id === view.messageId);
    if (!state) throw new Error('thiếu tin');
    const message = Message.restore(state);
    for (const viewer of [A, B, OUTSIDER]) {
      expect(toMessageDto(realtimeFromSent(view), viewer).body).toBe(message.bodyFor(viewer));
    }
  });

  it('người gửi thấy body gốc + clientMessageId', () => {
    expect(toMessageDto(base, A.toUpperCase())).toMatchObject({
      body: 'zalo 0912345678',
      masked: false,
      clientMessageId: base.clientMessageId,
    });
  });

  it('người nhận thấy maskedBody, không thấy clientMessageId', () => {
    expect(toMessageDto(base, B)).toMatchObject({ body: 'zalo ***', masked: true, clientMessageId: null });
  });

  it('không bị che → người nhận thấy body gốc; tin hệ thống → body cho cả hai', () => {
    expect(toMessageDto({ ...base, maskedBody: null }, B)).toMatchObject({ body: base.body, masked: false });
    const system = {
      ...base,
      senderId: null,
      kind: 'SYSTEM' as const,
      maskedBody: null,
      clientMessageId: null,
    };
    expect(toMessageDto(system, A)).toMatchObject({ body: base.body, masked: false, senderId: null });
  });
});
