import { createDatabase, type Database } from '@tamgiao/db';
import { FakeClock } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoopErrorReporter } from '../error-reporter.js';
import { OutboxBacklogMonitor, readOutboxBacklog } from '../outbox-backlog-monitor.js';

describe('OutboxBacklogMonitor trên Postgres thật (AC2)', () => {
  let database: Database;

  beforeAll(() => {
    database = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
  });
  beforeEach(() => resetDatabase(database.pool));
  afterAll(() => database.close());

  it('outbox có số event chưa publish > ngưỡng → cảnh báo; relay xong → recovered', async () => {
    await database.pool.query(
      `insert into platform.outbox
         (id, event_type, aggregate_type, aggregate_id, aggregate_version, payload, occurred_at)
       select gen_random_uuid(), 'TestEvent', 'Test', g::text, 1, '{}', now() from generate_series(1, 3) g`,
    );
    const errors: string[] = [];
    const monitor = new OutboxBacklogMonitor({
      read: () => readOutboxBacklog(database.pool),
      thresholds: { maxUnpublished: 2, maxAgeSeconds: 3_600 },
      reporter: new NoopErrorReporter(),
      logger: { error: (_o, msg) => void errors.push(msg), warn: () => undefined, info: () => undefined },
      clock: new FakeClock(new Date()),
    });

    expect(await monitor.check()).toMatchObject({
      status: 'alert',
      notified: true,
      backlog: { unpublished: 3 },
    });
    expect(errors).toEqual(['outbox backlog above threshold']);

    await database.pool.query('update platform.outbox set published_at = now()');
    expect(await monitor.check()).toEqual({
      status: 'recovered',
      backlog: { unpublished: 0, oldestAgeSeconds: 0 },
    });
  });
});
