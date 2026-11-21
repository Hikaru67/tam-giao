import { DrizzleUnitOfWork, createDatabase, jobIdFor, type Database } from '@tamgiao/db';
import { fail, ok } from '@tamgiao/kernel';
import { testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApiJobScheduler, type ApiJobScheduler } from '../job-scheduler.js';

const QUEUE = 'test.api-scheduled';

describe('startApiJobScheduler (pg-boss chỉ gửi job)', () => {
  let database: Database;
  let jobs: ApiJobScheduler;

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
    jobs = await startApiJobScheduler({
      connectionString: testDatabaseUrl(),
      queues: [QUEUE],
      retry: { retryLimit: 3, retryDelay: 7, retryBackoff: true },
      onError: () => undefined,
    });
  });

  afterAll(async () => {
    await jobs.stop();
    await database.close();
  });

  it('tạo queue + dead-letter lúc khởi động; job ghi cùng transaction (commit → có, rollback → không); không ai tiêu thụ', async () => {
    const { rows: queues } = await database.pool.query<Record<string, unknown>>(
      `select name, retry_limit, retry_delay, retry_backoff, dead_letter from pgboss.queue
        where name in ($1, $2) order by name`,
      [QUEUE, `${QUEUE}.dead`],
    );
    expect(queues).toEqual([
      { name: QUEUE, retry_limit: 3, retry_delay: 7, retry_backoff: true, dead_letter: `${QUEUE}.dead` },
      expect.objectContaining({ name: `${QUEUE}.dead`, dead_letter: null }),
    ]);

    const uow = new DrizzleUnitOfWork(database.pool);
    const runAt = new Date(Date.now() - 60_000);
    await uow.run(async (tx) => {
      await jobs.scheduler.schedule(tx, { queue: QUEUE, key: 'committed:1', runAt, payload: { n: 1 } });
      return ok();
    });
    await uow.run(async (tx) => {
      await jobs.scheduler.schedule(tx, { queue: QUEUE, key: 'rolled-back:1', runAt, payload: { n: 2 } });
      return fail('SOMETHING_FAILED');
    });

    // Chờ một chút: API không có worker nên job tới hạn vẫn ở `created`.
    await new Promise((r) => setTimeout(r, 1_500));
    const { rows } = await database.pool.query<{ id: string; state: string }>(
      'select id, state from pgboss.job where name = $1',
      [QUEUE],
    );
    expect(rows).toEqual([{ id: jobIdFor(`${QUEUE}:committed:1`), state: 'created' }]);
  });
});
