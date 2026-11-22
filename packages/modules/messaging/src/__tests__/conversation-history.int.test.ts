import { createLogger } from '@tamgiao/config';
import { DATING_DAYS, MATCH_STARTED_DATING } from '@tamgiao/contracts';
import { createDatabase, deliverOnce, DrizzleUnitOfWork, EventBus, type Database } from '@tamgiao/db';
import { handleError, requestContext, requireUser, type AppEnv, type UserAuthenticator } from '@tamgiao/http';
import { FakeClock, addDuration, fail, newId, ok } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MessageScreener } from '../domain/message-policy.js';
import {
  OPEN_CONVERSATION_ON_MATCH_STARTED_DATING_CONSUMER,
  createMessagingModule,
  createMessagingWorker,
  type MessagingModule,
} from '../index.js';
import { InMemoryMessageBroadcaster } from './messaging-fakes.js';

/**
 * BE-S6-04 — HTTP + Postgres (Testcontainers): hộp thư `GET /me/conversations`, lịch sử phân trang theo con trỏ
 * (`before`/`after`, AC1: tin mới chen vào không làm trùng/sót), `POST /me/conversations/:id/read` (con trỏ lưu ở
 * `messaging.conversation_reads`, chỉ tiến kể cả khi gửi đồng thời), gợi ý phá băng; người ngoài → `NOT_PARTICIPANT`
 * (AC2).
 */

const T0 = new Date('2026-06-01T08:00:00.000Z');
const clock = new FakeClock(T0);
const logger = createLogger({ service: 'api', level: 'silent' });

let database: Database;
let uow: DrizzleUnitOfWork;
let module: MessagingModule;
let app: Hono<AppEnv>;
const broadcaster = new InMemoryMessageBroadcaster();

const bus = new EventBus();
createMessagingWorker({ clock }).registerConsumers(bus);
const openSub = bus.list().find((s) => s.consumer === OPEN_CONVERSATION_ON_MATCH_STARTED_DATING_CONSUMER);

const tokens = new Map<string, string>();
const authenticate: UserAuthenticator = async (token) => {
  const userId = tokens.get(token);
  return userId ? ok({ userId, sessionId: newId() }) : fail('UNAUTHENTICATED');
};

const screener: MessageScreener = (body) => ({
  maskedBody: body.includes('zalo') ? body.replace(/zalo\S*/g, '***') : null,
  flagged: false,
  reasons: [],
});

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
    occurredAt: clock.now(),
    payload: {
      matchId,
      participantIds: [a, b],
      expiresAt: addDuration(clock.now(), { days: DATING_DAYS }).toISOString(),
    },
  });
  const { rows } = await database.pool.query<{ id: string }>(
    'select id from messaging.conversations where match_id = $1',
    [matchId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('chưa mở hội thoại');
  return id;
}

async function send(senderId: string, body: string, conversation = conversationId): Promise<string> {
  clock.advance({ seconds: 1 });
  const r = await module.commands.sendMessage.execute({ conversationId: conversation, senderId, body });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value.messageId;
}

const call = async (token: string, path: string, init: RequestInit = {}): Promise<Response> =>
  app.request(path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });

interface Page {
  items: { messageId: string; body: string; masked: boolean; systemCode: string | null }[];
  hasMore: boolean;
}
const page = async (token: string, query: string): Promise<Page> => {
  const res = await call(token, `/me/conversations/${conversationId}/messages${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
};
const markRead = (token: string, messageId: string, conversation = conversationId) =>
  call(token, `/me/conversations/${conversation}/read`, {
    method: 'POST',
    body: JSON.stringify({ messageId }),
  });

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 8 });
  uow = new DrizzleUnitOfWork(database.pool);
  module = createMessagingModule({
    uow,
    clock,
    screener,
    requireUser: requireUser(authenticate),
    authenticateUser: authenticate,
    broadcaster,
    logger,
  });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(logger));
  app.route('/', module.routes);
  app.onError(handleError);
});

beforeEach(async () => {
  clock.set(T0);
  await resetDatabase(database.pool);
  broadcaster.published.length = 0;
  tokens.clear();
  A = newId();
  B = newId();
  tokens.set('tok-a', A);
  tokens.set('tok-b', B);
  tokens.set('tok-x', newId());
  conversationId = await openConversation(A, B);
});

afterAll(async () => {
  await database?.close();
});

describe('GET /me/conversations/:id/messages — phân trang theo con trỏ', () => {
  it('AC1: trang mới nhất → cuộn lùi bằng `before`; tin mới chen vào không làm trùng/sót; `after` lấy phần mới', async () => {
    const old: string[] = [];
    for (let i = 0; i < 6; i += 1) old.push(await send(i % 2 ? B : A, `tin ${i}`));

    const latest = await page('tok-a', '?limit=3');
    expect(latest.items.map((m) => m.messageId)).toEqual(old.slice(3));
    expect(latest.hasMore).toBe(true);

    // Người kia gửi thêm trong lúc A đang cuộn lên.
    const newer = [await send(B, 'mới 1'), await send(B, 'mới 2')];

    const cursor = latest.items[0]?.messageId ?? '';
    const older = await page('tok-a', `?before=${cursor}&limit=3`);
    expect(older.items.map((m) => m.messageId)).toEqual(old.slice(0, 3));
    expect(older.hasMore).toBe(true);
    const oldest = await page('tok-a', `?before=${old[0] ?? ''}&limit=3`);
    expect(oldest).toMatchObject({ items: [{ systemCode: 'CONVERSATION_OPENED' }], hasMore: false });

    const caughtUp = await page('tok-a', `?after=${latest.items.at(-1)?.messageId ?? ''}`);
    expect(caughtUp.items.map((m) => m.messageId)).toEqual(newer);
    expect(caughtUp.hasMore).toBe(false);
  });

  it('nội dung theo người xem; `after` + `before` cùng lúc → 422; AC2 người ngoài → 403 NOT_PARTICIPANT', async () => {
    await send(A, 'zalo.me/abc nhé');
    expect((await page('tok-b', '?limit=1')).items).toMatchObject([{ body: '*** nhé', masked: true }]);
    expect((await page('tok-a', '?limit=1')).items).toMatchObject([
      { body: 'zalo.me/abc nhé', masked: false },
    ]);
    const id = newId();
    const both = await call('tok-a', `/me/conversations/${conversationId}/messages?after=${id}&before=${id}`);
    expect(both.status).toBe(422);
    const outsider = await call('tok-x', `/me/conversations/${conversationId}/messages?before=${id}`);
    expect(outsider.status).toBe(403);
    expect(await outsider.json()).toMatchObject({ code: 'NOT_PARTICIPANT' });
  });
});

describe('POST /me/conversations/:id/read + GET /me/conversations', () => {
  it('hộp thư: tin cuối theo người xem, số chưa đọc giảm sau khi đánh dấu, tiến trình ngày X/14', async () => {
    await send(A, 'chào em');
    const m2 = await send(A, 'zalo.me/abc nhé');
    clock.set(addDuration(T0, { days: 5, hours: 2 }));

    const before = await call('tok-b', '/me/conversations');
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({
      items: [
        {
          conversationId,
          peerUserId: A,
          status: 'OPEN',
          openedAt: T0.toISOString(),
          closesAt: addDuration(T0, { days: DATING_DAYS }).toISOString(),
          datingDay: 6,
          datingDays: DATING_DAYS,
          lastMessage: expect.objectContaining({ messageId: m2, body: '*** nhé', masked: true }),
          unreadCount: 3,
          lastReadMessageId: null,
        },
      ],
    });

    const res = await markRead('tok-b', m2);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      conversationId,
      lastReadMessageId: m2,
      readAt: clock.now().toISOString(),
      unreadCount: 0,
    });
    expect(broadcaster.published).toMatchObject([
      { type: 'message.read', conversationId, readerId: B, messageId: m2, originConnectionId: null },
    ]);
    const after = (await (await call('tok-b', '/me/conversations')).json()) as {
      items: { unreadCount: number; lastReadMessageId: string }[];
    };
    expect(after.items[0]).toMatchObject({ unreadCount: 0, lastReadMessageId: m2 });
    // Người kia không bị ảnh hưởng (tin hệ thống mở hội thoại vẫn chưa đọc với A).
    const forA = (await (await call('tok-a', '/me/conversations')).json()) as {
      items: { unreadCount: number; lastReadMessageId: string | null }[];
    };
    expect(forA.items[0]).toMatchObject({ unreadCount: 1, lastReadMessageId: null });
  });

  it('con trỏ chỉ tiến: tin cũ hơn không lùi, không phát realtime; gửi đồng thời giữ con trỏ lớn nhất', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await send(A, `tin ${i}`));
    const results = await runConcurrently(ids.length, (i) => markRead('tok-b', ids[i] ?? ''));
    for (const r of results) expect(r.status === 'fulfilled' && r.value.status).toBe(200);
    const { rows } = await database.pool.query<{ last_read_message_id: string }>(
      'select last_read_message_id from messaging.conversation_reads where conversation_id = $1 and user_id = $2',
      [conversationId, B],
    );
    expect(rows).toEqual([{ last_read_message_id: ids[4] }]);

    broadcaster.published.length = 0;
    const stale = await markRead('tok-b', ids[1] ?? '');
    expect(await stale.json()).toMatchObject({ lastReadMessageId: ids[4], unreadCount: 0 });
    expect(broadcaster.published).toEqual([]);
  });

  it('AC2: người ngoài → 403 NOT_PARTICIPANT; tin của hội thoại khác → 404; body sai → 422; không token → 401', async () => {
    const m = await send(A, 'tin');
    const otherConversation = await openConversation(newId(), newId());
    const foreign = (
      await database.pool.query<{ id: string }>(
        'select id from messaging.messages where conversation_id = $1 limit 1',
        [otherConversation],
      )
    ).rows[0]?.id;
    const outsider = await markRead('tok-x', m);
    expect(outsider.status).toBe(403);
    expect(await outsider.json()).toMatchObject({ code: 'NOT_PARTICIPANT' });
    const wrong = await markRead('tok-a', foreign ?? '');
    expect(wrong.status).toBe(404);
    expect((await markRead('tok-a', 'abc')).status).toBe(422);
    expect((await app.request(`/me/conversations/${conversationId}/read`, { method: 'POST' })).status).toBe(
      401,
    );
    const { rows } = await database.pool.query('select * from messaging.conversation_reads');
    expect(rows).toEqual([]);
  });

  it('hộp thư chỉ có hội thoại của mình; người ngoài nhận danh sách rỗng', async () => {
    const res = await call('tok-x', '/me/conversations');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });
});

describe('GET /me/conversations/:id/icebreakers', () => {
  it('gợi ý theo ngày tìm hiểu; người ngoài → 403', async () => {
    clock.set(addDuration(T0, { days: 8, hours: 1 }));
    const res = await call('tok-a', `/me/conversations/${conversationId}/icebreakers`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      conversationId,
      datingDay: 9,
      datingDays: DATING_DAYS,
      theme: 'Chủ đề sâu',
      topics: expect.arrayContaining([expect.any(String)]),
    });
    expect((await call('tok-x', `/me/conversations/${conversationId}/icebreakers`)).status).toBe(403);
  });
});
