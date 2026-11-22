import { MESSAGE_RATE_LIMIT_PER_MINUTE } from '@tamgiao/contracts/constants';
import { FakeClock, addDuration, newId, type Tx } from '@tamgiao/kernel';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CloseConversationForMatch,
  OpenConversationForMatch,
} from '../application/conversation-lifecycle.js';
import { SendMessage } from '../application/send-message.js';
import type { ConversationId } from '../domain/conversation.js';
import { parseClientMessageId } from '../domain/message.js';
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
let conversations: InMemoryConversationRepository;
let messages: InMemoryMessageRepository;
let send: SendMessage;

const lifecycle = () => ({ clock, conversations, messages });

async function openConversation(matchId = newId<'Match'>()): Promise<ConversationId> {
  await new OpenConversationForMatch(lifecycle()).handle(TX, {
    matchId,
    participantIds: [A, B],
    openedAt: T0,
    closesAt: CLOSES,
  });
  const state = [...conversations.states.values()].find((s) => s.matchId === matchId);
  if (!state) throw new Error('chưa mở hội thoại');
  return state.id;
}

const textMessages = () => messages.states.filter((m) => m.kind === 'TEXT');

beforeEach(() => {
  clock = new FakeClock(T0);
  conversations = new InMemoryConversationRepository();
  messages = new InMemoryMessageRepository();
  send = new SendMessage({ uow: new PassThroughUnitOfWork(), clock, conversations, messages });
});

describe('parseClientMessageId', () => {
  it('nhận UUID mọi phiên bản (chuẩn hoá chữ thường), từ chối chuỗi khác', () => {
    const v4 = randomUUID();
    expect(parseClientMessageId(v4.toUpperCase()).unwrapOr(undefined as never)).toBe(v4);
    expect(parseClientMessageId(newId()).isOk()).toBe(true);
    expect(parseClientMessageId('abc')).toMatchObject({ error: { code: 'INVALID_ID' } });
  });
});

describe('SendMessage — idempotency key phía client (BE-S6-02)', () => {
  it('AC2: gửi lại cùng clientMessageId → trả lại tin cũ (replayed), chỉ 1 tin, không event mới', async () => {
    const id = await openConversation();
    const key = randomUUID();
    const first = await send.execute({ conversationId: id, senderId: A, body: 'Chào', clientMessageId: key });
    const eventsAfterFirst = messages.events.length;
    clock.advance({ seconds: 5 });
    const second = await send.execute({
      conversationId: id,
      senderId: A,
      body: 'Chào (gửi lại)',
      clientMessageId: key.toUpperCase(),
    });
    expect(first.unwrapOr(undefined as never)).toMatchObject({ replayed: false, clientMessageId: key });
    const replay = second.unwrapOr(undefined as never);
    expect(replay).toMatchObject({
      replayed: true,
      messageId: first.unwrapOr(undefined as never).messageId,
      body: 'Chào',
      sentAt: T0,
    });
    expect(textMessages()).toHaveLength(1);
    expect(messages.events).toHaveLength(eventsAfterFirst);
  });

  it('key khác nhau → tin khác nhau; không gửi key → luôn tạo tin mới', async () => {
    const id = await openConversation();
    await send.execute({ conversationId: id, senderId: A, body: '1', clientMessageId: randomUUID() });
    await send.execute({ conversationId: id, senderId: A, body: '2', clientMessageId: randomUUID() });
    await send.execute({ conversationId: id, senderId: A, body: '3' });
    await send.execute({ conversationId: id, senderId: A, body: '3' });
    expect(textMessages()).toHaveLength(4);
  });

  it('cùng key nhưng người gửi khác → hai tin riêng (key tính theo người gửi)', async () => {
    const id = await openConversation();
    const key = randomUUID();
    await send.execute({ conversationId: id, senderId: A, body: 'a', clientMessageId: key });
    const fromB = await send.execute({ conversationId: id, senderId: B, body: 'b', clientMessageId: key });
    expect(fromB.unwrapOr(undefined as never).replayed).toBe(false);
    expect(textMessages()).toHaveLength(2);
  });

  it('gửi lại sau khi hội thoại đóng → vẫn trả tin cũ (không CONVERSATION_CLOSED)', async () => {
    const matchId = newId<'Match'>();
    const id = await openConversation(matchId);
    const key = randomUUID();
    await send.execute({ conversationId: id, senderId: A, body: 'Chào', clientMessageId: key });
    await new CloseConversationForMatch(lifecycle()).handle(TX, {
      matchId,
      participantIds: [A, B],
      reason: 'MATCH_LOCKED',
      fromStatus: 'DATING',
      closedAt: addDuration(T0, { minutes: 1 }),
    });
    const replay = await send.execute({
      conversationId: id,
      senderId: A,
      body: 'Chào',
      clientMessageId: key,
    });
    expect(replay.unwrapOr(undefined as never).replayed).toBe(true);
    const fresh = await send.execute({
      conversationId: id,
      senderId: A,
      body: 'Mới',
      clientMessageId: randomUUID(),
    });
    expect(fresh).toMatchObject({ error: { code: 'CONVERSATION_CLOSED' } });
  });

  it('gửi lại không bị tính rate limit', async () => {
    const id = await openConversation();
    const key = randomUUID();
    await send.execute({ conversationId: id, senderId: A, body: 'đầu', clientMessageId: key });
    for (let i = 1; i < MESSAGE_RATE_LIMIT_PER_MINUTE; i += 1) {
      await send.execute({ conversationId: id, senderId: A, body: `tin ${i}` });
    }
    const limited = await send.execute({
      conversationId: id,
      senderId: A,
      body: 'quá',
      clientMessageId: randomUUID(),
    });
    expect(limited).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    const replay = await send.execute({ conversationId: id, senderId: A, body: 'đầu', clientMessageId: key });
    expect(replay.unwrapOr(undefined as never).replayed).toBe(true);
  });

  it('key đã dùng ở hội thoại khác → CLIENT_MESSAGE_ID_CONFLICT', async () => {
    const first = await openConversation();
    const second = await openConversation();
    const key = randomUUID();
    await send.execute({ conversationId: first, senderId: A, body: 'x', clientMessageId: key });
    const r = await send.execute({ conversationId: second, senderId: A, body: 'x', clientMessageId: key });
    expect(r).toMatchObject({ error: { code: 'CLIENT_MESSAGE_ID_CONFLICT' } });
  });

  it('người ngoài cặp dùng key của người khác → NOT_PARTICIPANT (không lộ tin)', async () => {
    const id = await openConversation();
    const key = randomUUID();
    await send.execute({ conversationId: id, senderId: A, body: 'bí mật', clientMessageId: key });
    const r = await send.execute({ conversationId: id, senderId: OUTSIDER, body: 'x', clientMessageId: key });
    expect(r).toMatchObject({ error: { code: 'NOT_PARTICIPANT' } });
  });

  it('tin bị gắn cờ gửi lại → không tạo lại FRAUD_WARNING, systemMessages rỗng', async () => {
    const id = await openConversation();
    const flagging = new SendMessage({
      uow: new PassThroughUnitOfWork(),
      clock,
      conversations,
      messages,
      screener: () => ({ maskedBody: null, flagged: true, reasons: ['BANK_TRANSFER'] }),
    });
    const key = randomUUID();
    const first = await flagging.execute({
      conversationId: id,
      senderId: A,
      body: 'ck nhé',
      clientMessageId: key,
    });
    const again = await flagging.execute({
      conversationId: id,
      senderId: A,
      body: 'ck nhé',
      clientMessageId: key,
    });
    expect(first.unwrapOr(undefined as never).systemMessages).toHaveLength(1);
    expect(again.unwrapOr(undefined as never)).toMatchObject({ replayed: true, systemMessages: [] });
    expect(messages.states.filter((m) => m.systemCode === 'FRAUD_WARNING')).toHaveLength(1);
  });

  it('clientMessageId sai dạng → INVALID_ID, không chạm DB', async () => {
    const id = await openConversation();
    const r = await send.execute({
      conversationId: id,
      senderId: A,
      body: 'x',
      clientMessageId: 'not-a-uuid',
    });
    expect(r).toMatchObject({ error: { code: 'INVALID_ID', details: { field: 'clientMessageId' } } });
    expect(textMessages()).toHaveLength(0);
  });
});
