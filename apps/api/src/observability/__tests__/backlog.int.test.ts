import { createDatabase, type Database } from '@tamgiao/db';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readOutboxBacklog, readQueueDepths } from '../backlog.js';

const QUEUE = 'test.metrics-queue-depth';

async function insertOutbox(database: Database, id: string, createdAgoSeconds: number, published: boolean) {
  await database.pool.query(
    `insert into platform.outbox
       (id, event_type, aggregate_type, aggregate_id, aggregate_version, payload, occurred_at, created_at, published_at)
     values ($1::uuid, 'TestEvent', 'Test', $1::text, 1, '{}', now(), now() - make_interval(secs => $2), $3)`,
    [id, createdAgoSeconds, published ? new Date() : null],
  );
}

describe('metric sources (Postgres thật)', () => {
  let database: Database;

  beforeAll(() => {
    database = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
  });
  beforeEach(() => resetDatabase(database.pool));
  afterAll(() => database.close());

  it('readOutboxBacklog: outbox trống → 0', async () => {
    expect(await readOutboxBacklog(database.pool)).toEqual({ unpublished: 0, oldestAgeSeconds: 0 });
  });

  it('readOutboxBacklog: chỉ đếm event chưa publish, tuổi = event chưa publish cũ nhất', async () => {
    await insertOutbox(database, '0190a3f2-0000-7000-8000-000000000001', 600, true);
    await insertOutbox(database, '0190a3f2-0000-7000-8000-000000000002', 120, false);
    await insertOutbox(database, '0190a3f2-0000-7000-8000-000000000003', 5, false);
    const backlog = await readOutboxBacklog(database.pool);
    expect(backlog.unpublished).toBe(2);
    expect(backlog.oldestAgeSeconds).toBeGreaterThanOrEqual(120);
    expect(backlog.oldestAgeSeconds).toBeLessThan(180);
  });

  it('readQueueDepths: đếm job chờ theo hàng đợi pg-boss', async () => {
    const boss = new PgBoss({ connectionString: testDatabaseUrl(), supervise: false, schedule: false });
    await boss.start();
    try {
      await boss.createQueue(QUEUE);
      await boss.send(QUEUE, { n: 1 });
      await boss.send(QUEUE, { n: 2 });
      const depths = await readQueueDepths(database.pool);
      expect(depths).toContainEqual({ queue: QUEUE, state: 'created', count: 2 });
    } finally {
      await boss.deleteQueue(QUEUE);
      await boss.stop({ graceful: false, timeout: 2_000 });
    }
  });
});
