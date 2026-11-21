import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { createLogger } from '@tamgiao/config';
import { MATCH_STARTED_DATING, WS_CLOSE_CODES } from '@tamgiao/contracts';
import { createDatabase, deliverOnce, DrizzleUnitOfWork, EventBus, type Database } from '@tamgiao/db';
import { handleError, requestContext, requireUser, type AppEnv, type UserAuthenticator } from '@tamgiao/http';
import { FakeClock, addDuration, fail, newId, ok } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MessageScreener } from '../domain/message-policy.js';
import {
  OPEN_CONVERSATION_ON_MATCH_STARTED_DATING_CONSUMER,
  RedisMessageBroadcaster,
  createMessagingModule,
  createMessagingWorker,
  type MessagingModule,
} from '../index.js';
import { WsTestClient, sleep } from './ws-test-client.js';

/**
 * BE-S6-02 — tích hợp: 2 instance Hono (HTTP server thật, cổng riêng) + Postgres + Redis (Testcontainers).
 * AC1: client ở 2 instance khác nhau nhận tin của nhau qua Redis pub/sub. AC2: gửi lại cùng idempotency key → 1 tin
 * (kể cả gửi lại qua instance khác / đồng thời; unique ở DB). AC3: token hết hạn / không phải participant → bị ngắt
 * với mã lỗi. Nối lại: `GET /me/conversations/:id/messages?after=` lấy tin bị lỡ.
 */

const T0 = new Date('2026-06-01T08:00:00.000Z');
const clock = new FakeClock(T0);
const logger = createLogger({ service: 'api', level: 'silent' });

let database: Database;
let uow: DrizzleUnitOfWork;
let redis: StartedTestContainer;
let redisUrl: string;
const channel = `test:messaging:${newId()}`;

const bus = new EventBus();
createMessagingWorker({ clock }).registerConsumers(bus);
const openSub = bus.list().find((s) => s.consumer === OPEN_CONVERSATION_ON_MATCH_STARTED_DATING_CONSUMER);

const tokens = new Map<string, string>();
const authenticate: UserAuthenticator = async (token) => {
  if (token === 'expired') return fail('TOKEN_EXPIRED');
  const userId = tokens.get(token);
  return userId ? ok({ userId, sessionId: newId() }) : fail('UNAUTHENTICATED');
};

/** Giả lập ContactMasker (BE-S6-03): che "zalo…". */
const screener: MessageScreener = (body) => ({
  maskedBody: body.includes('zalo') ? body.replace(/zalo\S*/g, '***') : null,
  flagged: false,
  reasons: [],
});

interface Instance {
  readonly url: string;
  readonly module: MessagingModule;
  readonly server: ServerType;
  readonly broadcaster: RedisMessageBroadcaster;
}
const instances: Instance[] = [];

async function startInstance(): Promise<Instance> {
  const broadcaster = new RedisMessageBroadcaster({ url: redisUrl, channel });
  const module = createMessagingModule({
    uow,
    clock,
    screener,
    requireUser: requireUser(authenticate),
    authenticateUser: authenticate,
    broadcaster,
    logger,
  });
  const app = new Hono<AppEnv>();
  app.use('*', requestContext(logger));
  app.route('/', module.routes);
  app.onError(handleError);
  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s));
  });
  await module.realtime.attach(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const instance = { url, module, server, broadcaster };
  instances.push(instance);
  return instance;
}

let one: Instance;
let two: Instance;
let A: string;
let B: string;
let conversationId: string;

async function openConversation(a: string, b: string): Promise<string> {
  if (!openSub) throw new Error('thiếu consumer mở hội thoại');
  const matchId = newId();
  await deliverOnce(uow, openSub, {
    eventId: newId(),
    type: MATCH_STARTED_DATING,
    aggregateType: 'Match',
    aggregateId: matchId,
    version: 3,
    occurredAt: T0,
    payload: { matchId, participantIds: [a, b], expiresAt: addDuration(T0, { days: 14 }).toISOString() },
  });
  const { rows } = await database.pool.query<{ id: string }>(
    'select id from messaging.conversations where match_id = $1',
    [matchId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('chưa mở hội thoại');
  return id;
}

const textCount = async (id: string) => {
  const { rows } = await database.pool.query<{ n: string }>(
    `select count(*) as n from messaging.messages where conversation_id = $1 and kind = 'TEXT'`,
    [id],
  );
  return Number(rows[0]?.n);
};

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 8 });
  uow = new DrizzleUnitOfWork(database.pool);
  redis = await new GenericContainer('redis:7.4-alpine').withExposedPorts(6379).start();
  redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  one = await startInstance();
  two = await startInstance();
});

beforeEach(async () => {
  clock.set(T0);
  await resetDatabase(database.pool);
  tokens.clear();
  A = newId();
  B = newId();
  tokens.set('tok-a', A);
  tokens.set('tok-b', B);
  tokens.set('tok-x', newId());
  conversationId = await openConversation(A, B);
});

afterAll(async () => {
  for (const i of instances) {
    await i.module.realtime.close();
    await i.broadcaster.close();
    await new Promise<void>((resolve) => i.server.close(() => resolve()));
  }
  await redis?.stop();
  await database?.close();
});

describe('AC1 — đa instance qua Redis pub/sub', () => {
  it('A ở instance 1, B ở instance 2 nhận tin của nhau (nội dung theo người xem)', async () => {
    const a = await WsTestClient.ready(one.url, 'tok-a');
    const b = await WsTestClient.ready(two.url, 'tok-b');
    await a.join(conversationId);
    await b.join(conversationId);

    const keyA = randomUUID();
    a.send({ type: 'message.send', conversationId, clientMessageId: keyA, body: 'Chào em, zalo:0912345678' });
    const ackA = await a.next<'message.ack'>((f) => f.type === 'message.ack');
    const atB = await b.next<'message.new'>((f) => f.type === 'message.new');
    expect(ackA.message).toMatchObject({ senderId: A, body: 'Chào em, zalo:0912345678', masked: false });
    expect(atB.message).toEqual({
      ...ackA.message,
      body: 'Chào em, ***',
      masked: true,
      clientMessageId: null,
    });

    b.send({ type: 'message.send', conversationId, clientMessageId: randomUUID(), body: 'Chào anh' });
    const atA = await a.next<'message.new'>((f) => f.type === 'message.new');
    expect(atA.message).toMatchObject({
      senderId: B,
      body: 'Chào anh',
      masked: false,
      clientMessageId: null,
    });

    b.send({ type: 'typing', conversationId, isTyping: true });
    expect(await a.next((f) => f.type === 'typing')).toMatchObject({ userId: B, isTyping: true });
    a.send({ type: 'message.read', conversationId, messageId: atA.message.messageId });
    expect(await b.next((f) => f.type === 'message.read')).toMatchObject({
      readerId: A,
      messageId: atA.message.messageId,
    });

    expect(await textCount(conversationId)).toBe(2);
    a.close();
    b.close();
  });

  it('không rò sự kiện sang hội thoại khác (cặp khác chỉ nhận tin của phòng mình)', async () => {
    const C = newId();
    const D = newId();
    tokens.set('tok-c', C);
    tokens.set('tok-d', D);
    const other = await openConversation(C, D);
    const a = await WsTestClient.ready(one.url, 'tok-a');
    const c = await WsTestClient.ready(two.url, 'tok-c');
    await a.join(conversationId);
    await c.join(other);
    a.send({ type: 'message.send', conversationId, clientMessageId: randomUUID(), body: 'riêng tư' });
    await a.next((f) => f.type === 'message.ack');
    await sleep(150);
    expect(c.ofType('message.new')).toHaveLength(0);
    a.close();
    c.close();
  });
});

describe('AC2 — idempotency key phía client', () => {
  it('gửi lại cùng clientMessageId (sau khi nối lại sang instance khác) → ack duplicate, 1 tin', async () => {
    const key = randomUUID();
    const first = await WsTestClient.ready(one.url, 'tok-a');
    first.send({ type: 'message.send', conversationId, clientMessageId: key, body: 'Hẹn cà phê nhé' });
    const ack1 = await first.next<'message.ack'>((f) => f.type === 'message.ack');
    first.close();

    const again = await WsTestClient.ready(two.url, 'tok-a');
    again.send({ type: 'message.send', conversationId, clientMessageId: key, body: 'Hẹn cà phê nhé' });
    const ack2 = await again.next<'message.ack'>((f) => f.type === 'message.ack');
    expect(ack1.duplicate).toBe(false);
    expect(ack2).toMatchObject({ duplicate: true, message: { messageId: ack1.message.messageId } });
    expect(await textCount(conversationId)).toBe(1);
    again.close();
  });

  it('gửi đồng thời cùng key → đúng 1 tin (khoá hội thoại tuần tự hoá), các lần còn lại replayed', async () => {
    const key = randomUUID();
    const results = await runConcurrently(5, () =>
      one.module.commands.sendMessage.execute({
        conversationId,
        senderId: A,
        body: 'x',
        clientMessageId: key,
      }),
    );
    const views = results.map((r) => {
      if (r.status !== 'fulfilled' || r.value.isErr()) throw new Error('gửi thất bại');
      return r.value.unwrapOr(undefined as never);
    });
    expect(new Set(views.map((v) => v.messageId)).size).toBe(1);
    expect(views.filter((v) => !v.replayed)).toHaveLength(1);
    expect(await textCount(conversationId)).toBe(1);
  });

  it('DB chặn trùng (sender_id, client_message_id) dù bỏ qua use case', async () => {
    const key = randomUUID();
    await one.module.commands.sendMessage.execute({
      conversationId,
      senderId: A,
      body: 'x',
      clientMessageId: key,
    });
    await expect(
      database.pool.query(
        `insert into messaging.messages (id, conversation_id, sender_id, kind, body, client_message_id, sent_at)
         values ($1, $2, $3, 'TEXT', 'y', $4, now())`,
        [newId(), conversationId, A, key],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'messages_sender_client_message_id_uq' });
  });
});

describe('AC3 — ngắt kết nối với mã lỗi', () => {
  it('token hết hạn → đóng 4401 TOKEN_EXPIRED', async () => {
    const c = await WsTestClient.connect(two.url, 'expired');
    expect(await c.closed).toEqual({ code: WS_CLOSE_CODES.TOKEN_EXPIRED, reason: 'TOKEN_EXPIRED' });
    expect(c.frames).toEqual([{ type: 'error', code: 'TOKEN_EXPIRED' }]);
  });

  it('không phải participant join → đóng 4403 NOT_PARTICIPANT, không nhận tin của cặp', async () => {
    const a = await WsTestClient.ready(one.url, 'tok-a');
    await a.join(conversationId);
    const x = await WsTestClient.ready(two.url, 'tok-x');
    x.send({ type: 'conversation.join', conversationId });
    expect(await x.closed).toEqual({ code: WS_CLOSE_CODES.NOT_PARTICIPANT, reason: 'NOT_PARTICIPANT' });
    a.send({ type: 'message.send', conversationId, clientMessageId: randomUUID(), body: 'hi' });
    await a.next((f) => f.type === 'message.ack');
    expect(x.ofType('message.new')).toHaveLength(0);
    a.close();
  });
});

describe('nối lại — GET /me/conversations/:id/messages?after=', () => {
  const get = (url: string, token: string, query = '') =>
    fetch(`${url}/me/conversations/${conversationId}/messages${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });

  it('B lỡ tin khi mất kết nối → lấy bù sau `after`, nội dung theo người xem', async () => {
    const a = await WsTestClient.ready(one.url, 'tok-a');
    const b = await WsTestClient.ready(two.url, 'tok-b');
    await a.join(conversationId);
    await b.join(conversationId);
    a.send({ type: 'message.send', conversationId, clientMessageId: randomUUID(), body: 'tin 1' });
    const seen = await b.next<'message.new'>((f) => f.type === 'message.new');
    b.close();
    await b.closed;

    for (const body of ['tin 2', 'zalo.me/abc tin 3']) {
      clock.advance({ seconds: 1 });
      a.send({ type: 'message.send', conversationId, clientMessageId: randomUUID(), body });
    }
    await a.next((f) => f.type === 'message.ack' && f.message.body.includes('tin 3'));

    const res = await get(two.url, 'tok-b', `?after=${seen.message.messageId}`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: { body: string; masked: boolean }[]; hasMore: boolean };
    expect(page).toEqual({
      items: [
        expect.objectContaining({ body: 'tin 2', masked: false }),
        expect.objectContaining({ body: '*** tin 3', masked: true }),
      ],
      hasMore: false,
    });
    const asSender = (await (
      await get(one.url, 'tok-a', `?after=${seen.message.messageId}&limit=1`)
    ).json()) as {
      items: { body: string }[];
      hasMore: boolean;
    };
    expect(asSender).toMatchObject({ items: [{ body: 'tin 2' }], hasMore: true });
    a.close();
  });

  it('người ngoài → 403 NOT_PARTICIPANT; không token → 401; after sai → 422/400', async () => {
    expect((await get(one.url, 'tok-x')).status).toBe(403);
    expect((await fetch(`${one.url}/me/conversations/${conversationId}/messages`)).status).toBe(401);
    expect((await get(one.url, 'tok-a', '?after=abc')).status).toBe(422);
    expect(await (await get(one.url, 'tok-a', `?after=${randomUUID()}`)).json()).toMatchObject({
      code: 'INVALID_ID',
    });
  });
});
