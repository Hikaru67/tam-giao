import { MATCH_CLOSED, MATCH_LOCKED, MATCH_STARTED_DATING } from '@tamgiao/contracts';
import { MESSAGE_RATE_LIMIT_PER_MINUTE } from '@tamgiao/contracts/constants';
import { createDatabase, deliverOnce, DrizzleUnitOfWork, EventBus, type Database } from '@tamgiao/db';
import { FakeClock, addDuration, fail, newId, type DomainEvent } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CLOSE_CONVERSATION_ON_MATCH_CLOSED_CONSUMER,
  CLOSE_CONVERSATION_ON_MATCH_LOCKED_CONSUMER,
  OPEN_CONVERSATION_ON_MATCH_STARTED_DATING_CONSUMER,
  createMessagingModule,
  createMessagingWorker,
} from '../index.js';
import { InMemoryMessageBroadcaster } from './messaging-fakes.js';

const T0 = new Date('2026-06-01T08:00:00.000Z');
const CLOSES = addDuration(T0, { days: 14 });

let database: Database;
let uow: DrizzleUnitOfWork;
const clock = new FakeClock(T0);
const bus = new EventBus();
createMessagingWorker({ clock }).registerConsumers(bus);

const sub = (consumer: string) => {
  const s = bus.list().find((x) => x.consumer === consumer);
  if (!s) throw new Error(`missing consumer ${consumer}`);
  return s;
};
const openSub = () => sub(OPEN_CONVERSATION_ON_MATCH_STARTED_DATING_CONSUMER);

const sql = (text: string, params: unknown[] = []) => database.pool.query(text, params);

interface Pair {
  readonly matchId: string;
  readonly a: string;
  readonly b: string;
}
const newPair = (): Pair => ({ matchId: newId(), a: newId(), b: newId() });

const startedDating = ({ matchId, a, b }: Pair): DomainEvent => ({
  eventId: newId(),
  type: MATCH_STARTED_DATING,
  aggregateType: 'Match',
  aggregateId: matchId,
  version: 3,
  occurredAt: T0,
  payload: { matchId, participantIds: [a, b], expiresAt: CLOSES.toISOString() },
});
const locked = ({ matchId, a, b }: Pair, fromStatus = 'DATING'): DomainEvent => ({
  eventId: newId(),
  type: MATCH_LOCKED,
  aggregateType: 'Match',
  aggregateId: matchId,
  version: 4,
  occurredAt: addDuration(T0, { days: 1 }),
  payload: { matchId, participantIds: [a, b], fromStatus, reason: 'REPORT_FILED' },
});
const closed = ({ matchId, a, b }: Pair): DomainEvent => ({
  eventId: newId(),
  type: MATCH_CLOSED,
  aggregateType: 'Match',
  aggregateId: matchId,
  version: 4,
  occurredAt: CLOSES,
  payload: {
    matchId,
    participantIds: [a, b],
    outcome: 'STOPPED',
    fromStatus: 'DATING',
    trigger: 'DATING_PERIOD_ENDED',
  },
});

async function conversationsOf(matchId: string) {
  const { rows } = await sql(
    `select id, status, close_reason, user_a, user_b, opened_at, closes_at, version
       from messaging.conversations where match_id = $1`,
    [matchId],
  );
  return rows as {
    id: string;
    status: string;
    close_reason: string | null;
    user_a: string;
    user_b: string;
    opened_at: Date;
    closes_at: Date;
    version: number;
  }[];
}

async function openedConversationId(pair: Pair): Promise<string> {
  await deliverOnce(uow, openSub(), startedDating(pair));
  const [row] = await conversationsOf(pair.matchId);
  if (!row) throw new Error('chưa mở hội thoại');
  return row.id;
}

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 8 });
  uow = new DrizzleUnitOfWork(database.pool);
});
beforeEach(async () => {
  clock.set(T0);
  await resetDatabase(database.pool);
});
afterAll(() => database.close());

describe('consumer mở/đóng hội thoại theo event matching', () => {
  it('đăng ký đúng tên consumer cho 3 event', () => {
    expect(bus.list().map((s) => [s.eventType, s.consumer])).toEqual([
      [MATCH_STARTED_DATING, OPEN_CONVERSATION_ON_MATCH_STARTED_DATING_CONSUMER],
      [MATCH_CLOSED, CLOSE_CONVERSATION_ON_MATCH_CLOSED_CONSUMER],
      [MATCH_LOCKED, CLOSE_CONVERSATION_ON_MATCH_LOCKED_CONSUMER],
    ]);
  });

  it('MatchStartedDating → hội thoại OPEN + tin hệ thống + outbox ConversationOpened/MessageSent', async () => {
    const pair = newPair();
    expect(await deliverOnce(uow, openSub(), startedDating(pair))).toBe(true);
    const [row] = await conversationsOf(pair.matchId);
    expect(row).toMatchObject({
      status: 'OPEN',
      user_a: pair.a,
      user_b: pair.b,
      opened_at: T0,
      closes_at: CLOSES,
      version: 1,
    });
    const { rows: msgs } = await sql(
      `select kind, system_code, sender_id from messaging.messages where conversation_id = $1`,
      [row?.id],
    );
    expect(msgs).toEqual([{ kind: 'SYSTEM', system_code: 'CONVERSATION_OPENED', sender_id: null }]);
    const { rows: outbox } = await sql(`select event_type from platform.outbox order by event_type`);
    expect(outbox.map((r) => r.event_type)).toEqual(['ConversationOpened', 'MessageSent']);
  });

  it('AC2: MatchStartedDating xử lý 2 lần (cùng event và event khác cho cùng match) → chỉ 1 hội thoại', async () => {
    const pair = newPair();
    const event = startedDating(pair);
    expect(await deliverOnce(uow, openSub(), event)).toBe(true);
    expect(await deliverOnce(uow, openSub(), event)).toBe(false); // processed_events
    expect(await deliverOnce(uow, openSub(), startedDating(pair))).toBe(true); // handler idempotent (A9)
    expect(await conversationsOf(pair.matchId)).toHaveLength(1);
    const { rows } = await sql(`select count(*)::int as n from messaging.messages`);
    expect(rows[0]?.n).toBe(1);
  });

  it('A10: nhiều lượt mở đồng thời cho cùng match → unique match_id giữ đúng 1 hội thoại; lượt thua chạy lại là no-op', async () => {
    const pair = newPair();
    const events = Array.from({ length: 5 }, () => startedDating(pair));
    const results = await runConcurrently(events.length, (i) =>
      deliverOnce(uow, openSub(), events[i] as DomainEvent),
    );
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    for (const r of results) {
      if (r.status === 'rejected')
        expect(errorChainText(r.reason)).toMatch(/conversations_match_id_uq|duplicate key/);
    }
    expect(await conversationsOf(pair.matchId)).toHaveLength(1);
    // pg-boss thử lại lượt thua: processed_events đã rollback → chạy lại handler → thấy hội thoại, không ghi gì.
    for (const [i, r] of results.entries()) {
      if (r.status === 'rejected')
        expect(await deliverOnce(uow, openSub(), events[i] as DomainEvent)).toBe(true);
    }
    expect(await conversationsOf(pair.matchId)).toHaveLength(1);
    const { rows } = await sql(`select count(*)::int as n from messaging.messages`);
    expect(rows[0]?.n).toBe(1);
  });

  it('MatchLocked / MatchClosed → CLOSED + tin hệ thống; giao lại không đổi', async () => {
    const lockedPair = newPair();
    await openedConversationId(lockedPair);
    const lockEvent = locked(lockedPair);
    expect(await deliverOnce(uow, sub(CLOSE_CONVERSATION_ON_MATCH_LOCKED_CONSUMER), lockEvent)).toBe(true);
    expect(await deliverOnce(uow, sub(CLOSE_CONVERSATION_ON_MATCH_LOCKED_CONSUMER), locked(lockedPair))).toBe(
      true,
    );
    expect(await conversationsOf(lockedPair.matchId)).toMatchObject([
      { status: 'CLOSED', close_reason: 'MATCH_LOCKED', version: 2 },
    ]);

    const closedPair = newPair();
    await openedConversationId(closedPair);
    expect(await deliverOnce(uow, sub(CLOSE_CONVERSATION_ON_MATCH_CLOSED_CONSUMER), closed(closedPair))).toBe(
      true,
    );
    expect(await conversationsOf(closedPair.matchId)).toMatchObject([
      { status: 'CLOSED', close_reason: 'MATCH_CLOSED' },
    ]);

    const { rows } = await sql(
      `select system_code, count(*)::int as n from messaging.messages group by system_code order by system_code`,
    );
    expect(rows).toEqual([
      { system_code: 'CONVERSATION_CLOSED', n: 2 },
      { system_code: 'CONVERSATION_OPENED', n: 2 },
    ]);
  });

  it('MatchLocked tới trước MatchStartedDating → hội thoại CLOSED sẵn, event mở không mở lại', async () => {
    const pair = newPair();
    await deliverOnce(uow, sub(CLOSE_CONVERSATION_ON_MATCH_LOCKED_CONSUMER), locked(pair));
    await deliverOnce(uow, openSub(), startedDating(pair));
    expect(await conversationsOf(pair.matchId)).toMatchObject([
      { status: 'CLOSED', close_reason: 'MATCH_LOCKED' },
    ]);

    const offered = newPair();
    await deliverOnce(uow, sub(CLOSE_CONVERSATION_ON_MATCH_LOCKED_CONSUMER), locked(offered, 'OFFERED'));
    expect(await conversationsOf(offered.matchId)).toHaveLength(0);
  });

  it('payload sai dạng → throw (rollback, không đánh dấu processed_events)', async () => {
    const bad: DomainEvent = { ...startedDating(newPair()), payload: { matchId: newId() } };
    await expect(deliverOnce(uow, openSub(), bad)).rejects.toThrow(/participantIds/);
    const { rows } = await sql(`select count(*)::int as n from platform.processed_events`);
    expect(rows[0]?.n).toBe(0);
  });
});

describe('SendMessage trên Postgres', () => {
  const messaging = () =>
    createMessagingModule({
      uow,
      clock,
      requireUser: async () => undefined,
      authenticateUser: async () => fail('UNAUTHENTICATED'),
      broadcaster: new InMemoryMessageBroadcaster(),
    }).commands.sendMessage;

  it('lưu tin; outbox MessageSent không chứa nội dung (PII)', async () => {
    const pair = newPair();
    const conversationId = await openedConversationId(pair);
    clock.advance({ minutes: 1 });
    const r = await messaging().execute({
      conversationId,
      senderId: pair.a,
      body: 'Chào anh, số em 0912345678',
    });
    expect(r.isOk()).toBe(true);
    const { rows } = await sql(
      `select sender_id, kind, body, masked_body, flagged, flag_reasons from messaging.messages where kind = 'TEXT'`,
    );
    expect(rows).toEqual([
      {
        sender_id: pair.a,
        kind: 'TEXT',
        body: 'Chào anh, số em 0912345678',
        masked_body: 'Chào anh, số em [SĐT đã ẩn]',
        flagged: false,
        flag_reasons: [],
      },
    ]);
    const { rows: outbox } = await sql(
      `select payload from platform.outbox where event_type = 'MessageSent' and payload->>'kind' = 'TEXT'`,
    );
    expect(outbox[0]?.payload).toMatchObject({ senderId: pair.a, recipientIds: [pair.b], flagged: false });
    expect(JSON.stringify(outbox)).not.toContain('0912345678');
  });

  it('BE-S6-03: tin lừa đảo → flagged + flag_reasons, FRAUD_WARNING visible_to người nhận, outbox không nội dung', async () => {
    const pair = newPair();
    const conversationId = await openedConversationId(pair);
    clock.advance({ minutes: 1 });
    const text = 'Em ơi chuyển khoản giúp anh 5 triệu, STK 0123456789 Vietcombank';
    const r = await messaging().execute({ conversationId, senderId: pair.a, body: text });
    expect(r.unwrapOr(undefined as never)).toMatchObject({ body: text, flagged: true });
    const { rows } = await sql(
      `select sender_id, kind, system_code, masked_body, flagged, flag_reasons, visible_to
         from messaging.messages where conversation_id = $1 and system_code is distinct from 'CONVERSATION_OPENED'
        order by id`,
      [conversationId],
    );
    expect(rows).toEqual([
      {
        sender_id: pair.a,
        kind: 'TEXT',
        system_code: null,
        masked_body: 'Em ơi chuyển khoản giúp anh 5 triệu, STK [SĐT đã ẩn] Vietcombank',
        flagged: true,
        flag_reasons: ['MONEY_TRANSFER', 'BANK_ACCOUNT', 'ACCOUNT_NUMBER', 'MONEY_AMOUNT'],
        visible_to: null,
      },
      {
        sender_id: null,
        kind: 'SYSTEM',
        system_code: 'FRAUD_WARNING',
        masked_body: null,
        flagged: false,
        flag_reasons: [],
        visible_to: pair.b,
      },
    ]);
    const { rows: outbox } = await sql(
      `select event_type, payload from platform.outbox
        where event_type in ('MessageSent', 'MessageFlagged') and payload->>'conversationId' = $1
          and payload->>'systemCode' is distinct from 'CONVERSATION_OPENED'
        order by id`,
      [conversationId],
    );
    expect(outbox.map((o) => o.event_type)).toEqual(['MessageSent', 'MessageFlagged', 'MessageSent']);
    expect(outbox[1]?.payload).toMatchObject({ senderId: pair.a, reasons: rows[0]?.flag_reasons });
    expect(outbox[2]?.payload).toMatchObject({ systemCode: 'FRAUD_WARNING', recipientIds: [pair.b] });
    expect(JSON.stringify(outbox)).not.toContain('0123456789');
    expect(JSON.stringify(outbox)).not.toContain('chuyển khoản');
  });

  it('CHECK: visible_to chỉ cho tin SYSTEM; system_code ngoài danh sách bị từ chối', async () => {
    const pair = newPair();
    const conversationId = await openedConversationId(pair);
    await expect(
      sql(
        `insert into messaging.messages (id, conversation_id, sender_id, kind, body, sent_at, visible_to)
         values ($1, $2, $3, 'TEXT', 'x', now(), $4)`,
        [newId(), conversationId, pair.a, pair.b],
      ),
    ).rejects.toThrow(/messages_visible_to_ck/);
    await expect(
      sql(
        `insert into messaging.messages (id, conversation_id, kind, system_code, body, sent_at)
         values ($1, $2, 'SYSTEM', 'OTHER', 'x', now())`,
        [newId(), conversationId],
      ),
    ).rejects.toThrow(/messages_system_code_ck/);
  });

  it('AC1: hội thoại đã đóng (MatchLocked) → CONVERSATION_CLOSED, không lưu tin', async () => {
    const pair = newPair();
    const conversationId = await openedConversationId(pair);
    await deliverOnce(uow, sub(CLOSE_CONVERSATION_ON_MATCH_LOCKED_CONSUMER), locked(pair));
    const r = await messaging().execute({ conversationId, senderId: pair.b, body: 'alo' });
    expect(r).toMatchObject({ error: { code: 'CONVERSATION_CLOSED' } });
    const { rows } = await sql(`select count(*)::int as n from messaging.messages where kind = 'TEXT'`);
    expect(rows[0]?.n).toBe(0);
  });

  it('người ngoài cặp → NOT_PARTICIPANT; hội thoại không có → NOT_FOUND', async () => {
    const conversationId = await openedConversationId(newPair());
    expect(await messaging().execute({ conversationId, senderId: newId(), body: 'hi' })).toMatchObject({
      error: { code: 'NOT_PARTICIPANT' },
    });
    expect(
      await messaging().execute({ conversationId: newId(), senderId: newId(), body: 'hi' }),
    ).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });

  it(`rate limit đếm trên DB: ${MESSAGE_RATE_LIMIT_PER_MINUTE} tin đồng thời ok, tin kế tiếp → RATE_LIMITED`, async () => {
    const pair = newPair();
    const conversationId = await openedConversationId(pair);
    const send = messaging();
    const results = await runConcurrently(MESSAGE_RATE_LIMIT_PER_MINUTE + 5, (i) =>
      send.execute({ conversationId, senderId: pair.a, body: `tin ${i}` }),
    );
    const outcomes = results.map((r) =>
      r.status === 'fulfilled' ? (r.value.isOk() ? 'ok' : r.value.error.code) : 'throw',
    );
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(MESSAGE_RATE_LIMIT_PER_MINUTE);
    expect(outcomes.filter((o) => o === 'RATE_LIMITED')).toHaveLength(5);
    clock.advance({ seconds: 61 });
    expect((await send.execute({ conversationId, senderId: pair.a, body: 'sau 1 phút' })).isOk()).toBe(true);
  });
});

/** Drizzle bọc lỗi pg trong `Failed query: …` (lỗi gốc ở `cause`) — gộp message cả chuỗi `cause` để so khớp. */
function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
    parts.push(String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(' <- ');
}
