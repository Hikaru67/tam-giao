import { createDatabase, DrizzleUnitOfWork, type Database } from '@tamgiao/db';
import { newId, ok } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzlePairHistoryRepository } from '../infrastructure/drizzle-pair-history-repository.js';

const T0 = new Date('2026-11-21T03:00:00.000Z');
const T1 = new Date('2026-11-22T03:00:00.000Z');

let database: Database;
let uow: DrizzleUnitOfWork;
const repo = new DrizzlePairHistoryRepository();

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  uow = new DrizzleUnitOfWork(database.pool);
});
beforeEach(() => resetDatabase(database.pool));
afterAll(() => database.close());

const record = (a: string, b: string, outcome: string, matchId: string, now: Date) =>
  uow.run(async (tx) => {
    await repo.record(tx, a, b, outcome, matchId, now);
    return ok();
  });

const hasTried = async (a: string, b: string) => {
  const r = await uow.run(async (tx) => ok(await repo.hasTried(tx, a, b)));
  return r.isOk() && r.value;
};

const rows = async () =>
  (
    await database.pool.query<{
      user_low: string;
      user_high: string;
      last_outcome: string;
      last_match_id: string;
      updated_at: Date;
    }>('select * from matching.pair_history')
  ).rows;

describe('DrizzlePairHistoryRepository', () => {
  it('records a pair normalized as user_low < user_high and finds it in both orders', async () => {
    const [a, b, m] = [newId(), newId(), newId()];
    const [low, high] = a < b ? [a, b] : [b, a];
    await record(high, low, 'DECLINED', m, T0);

    expect(await rows()).toEqual([
      { user_low: low, user_high: high, last_outcome: 'DECLINED', last_match_id: m, updated_at: T0 },
    ]);
    expect(await hasTried(a, b)).toBe(true);
    expect(await hasTried(b, a)).toBe(true);
  });

  it('an untried pair is not tried, even if each user was in another pair', async () => {
    const [a, b, c] = [newId(), newId(), newId()];
    await record(a, b, 'EXPIRED', newId(), T0);
    expect(await hasTried(a, c)).toBe(false);
    expect(await hasTried(b, c)).toBe(false);
  });

  it('recording again overwrites the last outcome (one row per pair)', async () => {
    const [a, b, m1, m2] = [newId(), newId(), newId(), newId()];
    await record(a, b, 'EXPIRED', m1, T0);
    await record(b, a, 'CLOSED_STOPPED', m2, T1);

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ last_outcome: 'CLOSED_STOPPED', last_match_id: m2, updated_at: T1 });
  });

  it('rejects a pair of the same user (programming error)', async () => {
    const a = newId();
    await expect(record(a, a, 'DECLINED', newId(), T0)).rejects.toThrow();
    await expect(hasTried(a, a)).rejects.toThrow();
  });

  it('DB check rejects user_low >= user_high written outside the repository', async () => {
    const [a, b] = [newId(), newId()];
    const [low, high] = a < b ? [a, b] : [b, a];
    await expect(
      database.pool.query(
        `insert into matching.pair_history (user_low, user_high, last_outcome, last_match_id, updated_at)
         values ($1, $2, 'DECLINED', $3, now())`,
        [high, low, newId()],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'pair_history_order_ck' });
  });
});
