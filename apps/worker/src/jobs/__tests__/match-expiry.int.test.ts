import { DrizzleUnitOfWork, createDatabase, type Database, type JobLogger } from '@tamgiao/db';
import { MATCH_EXPIRY_QUEUE, type MatchExpiryPayload } from '@tamgiao/module-matching';
import { testDatabaseUrl } from '@tamgiao/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerMatchExpiryJob } from '../match-expiry.js';

const silent: JobLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('registerMatchExpiryJob (pg-boss)', () => {
  let database: Database;
  let boss: PgBoss;

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
    boss = new PgBoss({ connectionString: testDatabaseUrl(), schedule: false });
    boss.on('error', () => undefined);
    await boss.start();
    // Job còn sót từ test file khác (cùng DB) không được lẫn vào lần kiểm tra này.
    await database.pool.query('delete from pgboss.job where name = $1', [MATCH_EXPIRY_QUEUE]);
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, timeout: 2_000 });
    await database.close();
  });

  it('tạo hàng đợi + dead-letter, job gửi tới được chuyển cho ExpireMatch trong transaction', async () => {
    const received: MatchExpiryPayload[] = [];
    await registerMatchExpiryJob({
      boss,
      uow: new DrizzleUnitOfWork(database.pool),
      logger: silent,
      expirer: {
        executeIn: async (tx, payload) => {
          expect(tx).toBeDefined();
          received.push(payload);
          return { kind: 'ALREADY_CLOSED', status: 'EXPIRED' };
        },
      },
      pollingIntervalSeconds: 0.5,
    });
    expect(await boss.getQueue(`${MATCH_EXPIRY_QUEUE}.dead`)).not.toBeNull();

    await boss.send(MATCH_EXPIRY_QUEUE, { matchId: 'm-int' });
    const deadline = Date.now() + 15_000;
    const got = () => received.some((p) => p.matchId === 'm-int');
    while (!got() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    expect(received.filter((p) => p.matchId === 'm-int')).toEqual([{ matchId: 'm-int' }]);
  });
});
