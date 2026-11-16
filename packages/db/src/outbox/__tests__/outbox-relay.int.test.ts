import { fail, newId, ok, type DomainEvent } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../client.js';
import { PgBossScheduler, jobIdFor, registerJob, type JobLogger } from '../../jobs/pg-boss.js';
import { asPgClient } from '../../tx.js';
import { DrizzleUnitOfWork } from '../../unit-of-work.js';
import { EventBus } from '../event-bus.js';
import { OutboxRelay, deliverOnce, registerConsumers } from '../outbox-relay.js';
import { OutboxWriter } from '../outbox-writer.js';

let database: Database;
let uow: DrizzleUnitOfWork;
let boss: PgBoss;
const writer = new OutboxWriter();
const FAST = { retryLimit: 1, retryDelay: 0, retryBackoff: false } as const;

function captureLogger() {
  const entries: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const log = (level: string) => (obj: object, msg: string) =>
    void entries.push({ level, obj: obj as Record<string, unknown>, msg });
  const logger: JobLogger = { info: log('info'), warn: log('warn'), error: log('error') };
  return { logger, entries };
}

function event(type: string, aggregateId = newId<'Agg'>()): DomainEvent {
  return {
    eventId: newId<'DomainEvent'>(),
    type,
    aggregateType: 'Test',
    aggregateId,
    version: 1,
    occurredAt: new Date('2026-11-16T00:00:00.000Z'),
    payload: { aggregateId },
  };
}

async function writeEvents(events: DomainEvent[]): Promise<void> {
  await uow.run(async (tx) => {
    await writer.append(tx, events);
    return ok();
  });
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('waitFor: hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function unpublishedCount(): Promise<number> {
  const { rows } = await database.pool.query<{ n: string }>(
    'select count(*) as n from platform.outbox where published_at is null',
  );
  return Number(rows[0]?.n);
}

async function jobCount(queue: string): Promise<number> {
  const { rows } = await database.pool.query<{ n: string }>(
    'select count(*) as n from pgboss.job where name = $1',
    [queue],
  );
  return Number(rows[0]?.n);
}

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  boss = new PgBoss({ connectionString: testDatabaseUrl(), schedule: false });
  boss.on('error', () => {});
  await boss.start();
});

beforeEach(() => resetDatabase(database.pool));

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 2_000 });
  await database.close();
});

describe('OutboxRelay + consumer', () => {
  it('event tới handler đúng 1 lần dù 2 relay chạy song song và chạy lại (AC1)', async () => {
    const { logger } = captureLogger();
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('AC1Happened', 'test.ac1-consumer', async (e) => void seen.push(e.eventId));
    await registerConsumers({ boss, uow, bus, logger, retry: FAST, pollingIntervalSeconds: 0.5 });

    const events = [event('AC1Happened'), event('AC1Happened'), event('AC1Happened')];
    await writeEvents(events);

    const relayA = new OutboxRelay({ uow, boss, bus, logger });
    const relayB = new OutboxRelay({ uow, boss, bus, logger });
    const results = await runConcurrently(2, (i) => (i === 0 ? relayA : relayB).publishBatch());
    const published = results.map((r) => (r.status === 'fulfilled' ? r.value : -1));
    expect(published.reduce((a, b) => a + b, 0)).toBe(3);
    expect(await unpublishedCount()).toBe(0);
    expect(await relayA.publishBatch()).toBe(0);

    await waitFor(() => seen.length === 3);
    await new Promise((r) => setTimeout(r, 1_000));
    expect([...seen].sort()).toEqual(events.map((e) => e.eventId).sort());
    expect(await jobCount('evt.test.ac1-consumer')).toBe(3);
  });

  it('deliverOnce: cùng event giao 2 lần → handler chạy 1 lần (idempotent consumer)', async () => {
    let calls = 0;
    const sub = { eventType: 'X', consumer: 'test.once', handler: async () => void calls++ };
    const e = event('X');
    expect(await deliverOnce(uow, sub, e)).toBe(true);
    expect(await deliverOnce(uow, sub, e)).toBe(false);
    expect(calls).toBe(1);
  });

  it('deliverOnce: handler throw → rollback dấu đã xử lý, lần sau chạy lại được', async () => {
    let calls = 0;
    const sub = {
      eventType: 'X',
      consumer: 'test.flaky',
      handler: async () => {
        calls++;
        if (calls === 1) throw new Error('tạm lỗi');
      },
    };
    const e = event('X');
    await expect(deliverOnce(uow, sub, e)).rejects.toThrow('tạm lỗi');
    expect(await deliverOnce(uow, sub, e)).toBe(true);
    expect(calls).toBe(2);
  });

  it('handler luôn lỗi → thử lại rồi vào dead-letter, không chặn event khác (AC2)', async () => {
    const { logger, entries } = captureLogger();
    const bus = new EventBus();
    let poisonAttempts = 0;
    const handled: string[] = [];
    const poison = event('AC2Happened');
    const healthy = event('AC2Happened');
    bus.on('AC2Happened', 'test.ac2-consumer', async (e) => {
      if (e.eventId === poison.eventId) {
        poisonAttempts++;
        throw new Error('handler hỏng');
      }
      handled.push(e.eventId);
    });
    await registerConsumers({ boss, uow, bus, logger, retry: FAST, pollingIntervalSeconds: 0.5 });
    await writeEvents([poison, healthy]);
    await new OutboxRelay({ uow, boss, bus, logger }).publishBatch();

    await waitFor(() => handled.includes(healthy.eventId));
    await waitFor(() => entries.some((e) => e.msg === 'job moved to dead-letter'));
    expect(poisonAttempts).toBe(FAST.retryLimit + 1);
    const dead = entries.find((e) => e.msg === 'job moved to dead-letter');
    expect(dead?.obj.queue).toBe('evt.test.ac2-consumer');
    expect(JSON.stringify(dead?.obj.data)).toContain(poison.eventId);
    expect(entries.filter((e) => e.msg === 'event handler failed')).toHaveLength(FAST.retryLimit + 1);
  });

  it('event không có consumer → vẫn được đánh dấu đã phát', async () => {
    const { logger } = captureLogger();
    await writeEvents([event('NobodyListens')]);
    expect(await new OutboxRelay({ uow, boss, bus: new EventBus(), logger }).publishBatch()).toBe(1);
    expect(await unpublishedCount()).toBe(0);
  });

  it('relay start/stop chạy định kỳ và dừng sạch', async () => {
    const { logger } = captureLogger();
    const relay = new OutboxRelay({ uow, boss, bus: new EventBus(), logger, batchSize: 2 });
    await writeEvents([event('Tick'), event('Tick'), event('Tick')]);
    relay.start(100);
    await waitFor(async () => (await unpublishedCount()) === 0);
    await relay.stop();
  });
});

describe('PgBossScheduler', () => {
  it('cùng job key lên lịch 2 lần → chỉ 1 job; job chạy đúng thời điểm (AC3)', async () => {
    const { logger } = captureLogger();
    const queue = 'test.expire-thing';
    const ran: { at: number; payload: Readonly<Record<string, unknown>> }[] = [];
    await registerJob({
      boss,
      uow,
      logger,
      queue,
      retry: FAST,
      pollingIntervalSeconds: 0.5,
      // Lấy giờ của Postgres: pg-boss quyết định chạy job theo now() của DB, không theo đồng hồ host.
      handler: async (payload, tx) => {
        const { rows } = await asPgClient(tx).query<{ t: Date }>('select clock_timestamp() as t');
        ran.push({ at: rows[0]?.t.getTime() ?? 0, payload });
      },
    });
    const scheduler = new PgBossScheduler(boss);
    const { rows } = await database.pool.query<{ t: Date }>('select clock_timestamp() as t');
    const runAt = new Date((rows[0]?.t.getTime() ?? Date.now()) + 1_500);
    for (let i = 0; i < 2; i++) {
      await uow.run(async (tx) => {
        await scheduler.schedule(tx, {
          queue,
          key: 'match-1:3',
          runAt,
          payload: { matchId: 'match-1', attempt: i },
        });
        return ok();
      });
    }
    expect(await jobCount(queue)).toBe(1);
    expect(await boss.getJobById(queue, jobIdFor(`${queue}:match-1:3`))).not.toBeNull();

    await waitFor(() => ran.length === 1);
    expect(ran[0]?.at).toBeGreaterThanOrEqual(runAt.getTime());
    expect(ran[0]?.payload).toEqual({ matchId: 'match-1', attempt: 0 });
  });

  it('transaction rollback (Err) → job không được tạo', async () => {
    const { logger } = captureLogger();
    const queue = 'test.rolled-back';
    await registerJob({ boss, uow, logger, queue, retry: FAST, handler: async () => {} });
    const result = await uow.run(async (tx) => {
      await new PgBossScheduler(boss).schedule(tx, { queue, key: 'k', runAt: new Date(), payload: {} });
      return fail('SOMETHING_FAILED');
    });
    expect(result.isErr()).toBe(true);
    expect(await jobCount(queue)).toBe(0);
  });
});
