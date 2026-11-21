import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WS_CLOSE_CODES } from '@tamgiao/contracts';
import type { UserAuthenticator } from '@tamgiao/http';
import { FakeClock, addDuration, fail, newId, ok, type Tx } from '@tamgiao/kernel';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JoinConversation } from '../application/conversation-access.js';
import { OpenConversationForMatch } from '../application/conversation-lifecycle.js';
import { SendMessage } from '../application/send-message.js';
import type { MessageScreener } from '../domain/message-policy.js';
import { ChatGateway } from '../presentation/chat-gateway.js';
import {
  InMemoryConversationRepository,
  InMemoryMessageBroadcaster,
  InMemoryMessageRepository,
  PassThroughUnitOfWork,
} from './messaging-fakes.js';
import { WsTestClient, sleep } from './ws-test-client.js';

const T0 = new Date('2026-06-01T08:00:00.000Z');
const A = newId<'User'>();
const B = newId<'User'>();
const OUTSIDER = newId<'User'>();

/** Token giả → user; `expired` → TOKEN_EXPIRED; token bị xoá khỏi map = phiên bị thu hồi. */
const tokens = new Map<string, string>();
const authenticate: UserAuthenticator = async (token) => {
  if (token === 'expired') return fail('TOKEN_EXPIRED');
  const userId = tokens.get(token);
  return userId ? ok({ userId, sessionId: newId() }) : fail('UNAUTHENTICATED');
};

/** Che "zalo…" (giả lập ContactMasker), gắn cờ "chuyển khoản" (giả lập FraudDetector) — BE-S6-03. */
const maskingScreener: MessageScreener = (body) => {
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
let broadcaster: InMemoryMessageBroadcaster;
let conversationId: string;
const running: { gateway: ChatGateway; server: Server }[] = [];

async function startInstance(heartbeat?: { intervalMs: number; timeoutMs: number }): Promise<string> {
  const uow = new PassThroughUnitOfWork();
  const gateway = new ChatGateway({
    authenticate,
    joinConversation: new JoinConversation({ uow, conversations, messages }),
    sendMessage: new SendMessage({ uow, clock, conversations, messages, screener: maskingScreener }),
    broadcaster,
    clock,
    ...(heartbeat
      ? { heartbeatIntervalMs: heartbeat.intervalMs, heartbeatTimeoutMs: heartbeat.timeoutMs }
      : {}),
  });
  const server = createServer((_req, res) => res.writeHead(404).end());
  await gateway.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  running.push({ gateway, server });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  clock = new FakeClock(T0);
  conversations = new InMemoryConversationRepository();
  messages = new InMemoryMessageRepository();
  broadcaster = new InMemoryMessageBroadcaster();
  tokens.clear();
  tokens.set('tok-a', A);
  tokens.set('tok-a2', A);
  tokens.set('tok-b', B);
  tokens.set('tok-x', OUTSIDER);
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

afterEach(async () => {
  for (const { gateway, server } of running.splice(0)) {
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('ChatGateway — handshake', () => {
  it('không có token → frame error UNAUTHENTICATED + đóng 4401', async () => {
    const url = await startInstance();
    const c = await WsTestClient.connect(url);
    expect(await c.closed).toEqual({ code: WS_CLOSE_CODES.UNAUTHENTICATED, reason: 'UNAUTHENTICATED' });
    expect(c.frames).toEqual([{ type: 'error', code: 'UNAUTHENTICATED' }]);
  });

  it('AC3: token hết hạn → đóng 4401 TOKEN_EXPIRED', async () => {
    const url = await startInstance();
    const c = await WsTestClient.connect(url, 'expired');
    expect(await c.closed).toEqual({ code: 4401, reason: 'TOKEN_EXPIRED' });
  });

  it('token sai → 4401 UNAUTHENTICATED; token qua query access_token → ready', async () => {
    const url = await startInstance();
    const bad = await WsTestClient.connect(url, 'nope');
    expect((await bad.closed).reason).toBe('UNAUTHENTICATED');
    const viaQuery = await WsTestClient.connect(url, 'tok-b', 'query');
    expect(await viaQuery.next((f) => f.type === 'ready')).toEqual({ type: 'ready', userId: B });
    viaQuery.close();
  });

  it('đường dẫn khác /ws → từ chối upgrade', async () => {
    const url = await startInstance();
    const socket = new WebSocket(url.replace('http', 'ws') + '/other', {
      headers: { authorization: 'Bearer tok-a' },
    });
    await expect(
      new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      }),
    ).rejects.toThrow();
  });

  it('frame gửi ngay sau khi mở (trước khi xác thực xong) vẫn được xử lý theo thứ tự', async () => {
    const url = await startInstance();
    const c = await WsTestClient.connect(url, 'tok-a');
    c.send({ type: 'ping' });
    c.send({ type: 'conversation.join', conversationId });
    await c.next((f) => f.type === 'conversation.joined');
    expect(c.frames.map((f) => f.type)).toEqual(['ready', 'pong', 'conversation.joined']);
    c.close();
  });
});

describe('ChatGateway — phòng hội thoại', () => {
  it('AC3: không phải participant join → error NOT_PARTICIPANT + đóng 4403', async () => {
    const url = await startInstance();
    const x = await WsTestClient.ready(url, 'tok-x');
    x.send({ type: 'conversation.join', conversationId });
    expect(await x.closed).toEqual({ code: WS_CLOSE_CODES.NOT_PARTICIPANT, reason: 'NOT_PARTICIPANT' });
    expect(x.ofType('error')).toEqual([{ type: 'error', code: 'NOT_PARTICIPANT', conversationId }]);
  });

  it('hội thoại không tồn tại → đóng 4403 NOT_FOUND; id không phải UUID → VALIDATION_FAILED (giữ kết nối)', async () => {
    const url = await startInstance();
    const a = await WsTestClient.ready(url, 'tok-a');
    a.send({ type: 'conversation.join', conversationId: 'abc' });
    expect(await a.next((f) => f.type === 'error')).toMatchObject({ code: 'VALIDATION_FAILED' });
    a.send({ type: 'conversation.join', conversationId: newId() });
    expect(await a.closed).toEqual({ code: 4403, reason: 'NOT_FOUND' });
  });

  it('AC3: người ngoài gửi tin thẳng (không join) → NOT_PARTICIPANT + đóng 4403', async () => {
    const url = await startInstance();
    const x = await WsTestClient.ready(url, 'tok-x');
    const clientMessageId = randomUUID();
    x.send({ type: 'message.send', conversationId, clientMessageId, body: 'hi' });
    expect((await x.closed).code).toBe(4403);
    expect(x.ofType('error')).toEqual([
      { type: 'error', code: 'NOT_PARTICIPANT', clientMessageId, conversationId },
    ]);
    expect(messages.states.filter((m) => m.kind === 'TEXT')).toHaveLength(0);
  });
});

describe('ChatGateway — gửi tin', () => {
  it('AC1 (2 instance qua broadcaster): ack cho người gửi, message.new cho người nhận; nội dung theo người xem', async () => {
    const url1 = await startInstance();
    const url2 = await startInstance();
    const a = await WsTestClient.ready(url1, 'tok-a');
    const a2 = await WsTestClient.ready(url2, 'tok-a2'); // thiết bị thứ hai của A
    const b = await WsTestClient.ready(url2, 'tok-b');
    await Promise.all([a.join(conversationId), a2.join(conversationId), b.join(conversationId)]);

    const clientMessageId = randomUUID();
    a.send({ type: 'message.send', conversationId, clientMessageId, body: '  zalo:0912345678 nhé ' });
    const ack = await a.next<'message.ack'>((f) => f.type === 'message.ack');
    expect(ack).toMatchObject({
      clientMessageId,
      duplicate: false,
      message: { senderId: A, kind: 'TEXT', body: 'zalo:0912345678 nhé', masked: false, clientMessageId },
    });
    const toB = await b.next<'message.new'>((f) => f.type === 'message.new');
    expect(toB.message).toEqual({
      ...ack.message,
      body: '*** nhé',
      masked: true,
      clientMessageId: null,
    });
    const toA2 = await a2.next<'message.new'>((f) => f.type === 'message.new');
    expect(toA2.message).toEqual(ack.message);
    await sleep(50);
    expect(a.ofType('message.new')).toHaveLength(0); // kết nối phát không nhận lại tin của chính nó
    for (const c of [a, a2, b]) c.close();
  });

  it('tin bị gắn cờ → người nhận nhận thêm FRAUD_WARNING realtime, người gửi không', async () => {
    const url = await startInstance();
    const a = await WsTestClient.ready(url, 'tok-a');
    const a2 = await WsTestClient.ready(url, 'tok-a2');
    const b = await WsTestClient.ready(url, 'tok-b');
    await Promise.all([a.join(conversationId), a2.join(conversationId), b.join(conversationId)]);
    a.send({
      type: 'message.send',
      conversationId,
      clientMessageId: randomUUID(),
      body: 'chuyển khoản giúp anh',
    });
    const warning = await b.next<'message.new'>(
      (f) => f.type === 'message.new' && f.message.systemCode === 'FRAUD_WARNING',
    );
    expect(warning.message).toMatchObject({ kind: 'SYSTEM', senderId: null, masked: false });
    await a2.next((f) => f.type === 'message.new');
    await sleep(50);
    expect(b.ofType('message.new').map((f) => f.message.kind)).toEqual(['TEXT', 'SYSTEM']);
    expect(a2.ofType('message.new').map((f) => f.message.kind)).toEqual(['TEXT']);
    expect(a.ofType('message.new')).toHaveLength(0);
    for (const c of [a, a2, b]) c.close();
  });

  it('AC2: gửi lại cùng clientMessageId → ack duplicate, cùng messageId, chỉ 1 tin', async () => {
    const url = await startInstance();
    const a = await WsTestClient.ready(url, 'tok-a');
    await a.join(conversationId);
    const clientMessageId = randomUUID();
    a.send({ type: 'message.send', conversationId, clientMessageId, body: 'Chào' });
    a.send({ type: 'message.send', conversationId, clientMessageId, body: 'Chào' });
    await a.next((f) => f.type === 'message.ack' && f.duplicate);
    const acks = a.ofType('message.ack');
    expect(acks.map((x) => x.duplicate)).toEqual([false, true]);
    expect(acks[1]?.message.messageId).toBe(acks[0]?.message.messageId);
    expect(messages.states.filter((m) => m.kind === 'TEXT')).toHaveLength(1);
    a.close();
  });

  it('lỗi nghiệp vụ (MESSAGE_EMPTY / TOO_LONG) → frame error kèm clientMessageId, giữ kết nối', async () => {
    const url = await startInstance();
    const a = await WsTestClient.ready(url, 'tok-a');
    const clientMessageId = randomUUID();
    a.send({ type: 'message.send', conversationId, clientMessageId, body: '   ' });
    expect(await a.next((f) => f.type === 'error')).toEqual({
      type: 'error',
      code: 'MESSAGE_EMPTY',
      clientMessageId,
      conversationId,
    });
    a.send({ type: 'message.send', conversationId, clientMessageId: randomUUID(), body: 'x'.repeat(2_001) });
    expect(await a.next((f) => f.type === 'error' && f.code === 'MESSAGE_TOO_LONG')).toMatchObject({
      meta: { maxLength: 2_000, length: 2_001 },
    });
    a.send({ type: 'ping' });
    await a.next((f) => f.type === 'pong');
    a.close();
  });

  it('broadcaster lỗi → vẫn ack (tin đã lưu, người nhận lấy bù qua REST)', async () => {
    const url = await startInstance();
    const a = await WsTestClient.ready(url, 'tok-a');
    broadcaster.failNextPublish = true;
    a.send({ type: 'message.send', conversationId, clientMessageId: randomUUID(), body: 'hi' });
    expect(await a.next((f) => f.type === 'message.ack')).toMatchObject({ duplicate: false });
    a.close();
  });

  it('frame không phải JSON / sai schema → VALIDATION_FAILED, không trả lại giá trị đã gửi', async () => {
    const url = await startInstance();
    const a = await WsTestClient.ready(url, 'tok-a');
    a.socket.send('not json');
    a.send({ type: 'message.send', conversationId, clientMessageId: 'x', body: '0912345678' });
    await a.next((f) => f.type === 'error' && f.meta !== undefined);
    const errors = a.ofType('error');
    expect(errors.map((e) => e.code)).toEqual(['VALIDATION_FAILED', 'VALIDATION_FAILED']);
    expect(errors[1]?.meta).toEqual({ fields: ['clientMessageId'] });
    expect(JSON.stringify(errors)).not.toContain('0912345678');
    a.close();
  });
});

describe('ChatGateway — typing / đã đọc', () => {
  it('chưa join → CONVERSATION_NOT_JOINED; đã join → người kia nhận typing + message.read', async () => {
    const url = await startInstance();
    const a = await WsTestClient.ready(url, 'tok-a');
    const b = await WsTestClient.ready(url, 'tok-b');
    a.send({ type: 'typing', conversationId, isTyping: true });
    expect(await a.next((f) => f.type === 'error')).toEqual({
      type: 'error',
      code: 'CONVERSATION_NOT_JOINED',
      conversationId,
    });
    await Promise.all([a.join(conversationId), b.join(conversationId)]);
    a.send({ type: 'typing', conversationId, isTyping: true });
    expect(await b.next((f) => f.type === 'typing')).toEqual({
      type: 'typing',
      conversationId,
      userId: A,
      isTyping: true,
    });
    const messageId = newId();
    b.send({ type: 'message.read', conversationId, messageId });
    expect(await a.next((f) => f.type === 'message.read')).toEqual({
      type: 'message.read',
      conversationId,
      readerId: B,
      messageId,
      readAt: T0.toISOString(),
    });
    // Rời phòng → không nhận nữa.
    b.send({ type: 'conversation.leave', conversationId });
    b.send({ type: 'ping' });
    await b.next((f) => f.type === 'pong');
    a.send({ type: 'typing', conversationId, isTyping: false });
    await sleep(50);
    expect(b.ofType('typing')).toHaveLength(1);
    a.close();
    b.close();
  });
});

describe('ChatGateway — heartbeat', () => {
  it('AC3: phiên bị thu hồi / token hết hạn giữa chừng → đóng 4401 ở nhịp heartbeat kế tiếp', async () => {
    const url = await startInstance({ intervalMs: 50, timeoutMs: 1_000 });
    const a = await WsTestClient.ready(url, 'tok-a');
    tokens.delete('tok-a');
    expect(await a.closed).toEqual({ code: 4401, reason: 'UNAUTHENTICATED' });
  });

  it('client không trả pong / không gửi gì quá timeout → đóng 4408; client chuẩn (tự pong) được giữ', async () => {
    const url = await startInstance({ intervalMs: 40, timeoutMs: 120 });
    const healthy = await WsTestClient.ready(url, 'tok-b');
    const silent = new WebSocket(url.replace('http', 'ws') + '/ws', {
      headers: { authorization: 'Bearer tok-a' },
      autoPong: false,
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      silent.on('close', (code, reason) => resolve({ code, reason: reason.toString() })),
    );
    expect(await closed).toEqual({ code: WS_CLOSE_CODES.HEARTBEAT_TIMEOUT, reason: 'HEARTBEAT_TIMEOUT' });
    expect(healthy.socket.readyState).toBe(WebSocket.OPEN);
    healthy.close();
  });

  it('close() đóng mọi kết nối với 1001', async () => {
    const url = await startInstance();
    const a = await WsTestClient.ready(url, 'tok-a');
    const entry = running.pop();
    await entry?.gateway.close();
    expect((await a.closed).code).toBe(1001);
    await new Promise<void>((resolve) => entry?.server.close(() => resolve()));
  });
});
