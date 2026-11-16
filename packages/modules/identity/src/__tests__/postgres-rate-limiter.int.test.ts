import { DrizzleUnitOfWork, createDatabase, type Database } from '@tamgiao/db';
import { addDuration, ok } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RateLimitDecision } from '../application/ports/rate-limiter.js';
import { OTP_REQUEST_LIMITS } from '../domain/otp-policy.js';
import { PostgresRateLimiter } from '../infrastructure/postgres-rate-limiter.js';

let database: Database;
let uow: DrizzleUnitOfWork;
const limiter = new PostgresRateLimiter();
const T0 = new Date('2026-11-16T08:00:00.000Z');
const at = (seconds: number) => addDuration(T0, { seconds });

async function consume(key: string, now: Date, rules = OTP_REQUEST_LIMITS): Promise<RateLimitDecision> {
  const result = await uow.run(async (tx) => ok(await limiter.consume(tx, key, rules, now)));
  if (result.isErr()) throw new Error('unreachable');
  return result.value;
}

async function hitCount(key: string): Promise<number> {
  const { rows } = await database.pool.query<{ n: string }>(
    'select count(*) as n from identity.rate_limit_hits where key = $1',
    [key],
  );
  return Number(rows[0]?.n);
}

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
});
beforeEach(() => resetDatabase(database.pool));
afterAll(() => database.close());

describe('PostgresRateLimiter', () => {
  it('1 lượt/60s: lượt thứ hai bị chặn kèm thời gian chờ chính xác, hết 60s thì qua (AC3)', async () => {
    expect(await consume('k', at(0))).toEqual({ allowed: true });
    expect(await consume('k', at(1))).toEqual({ allowed: false, retryAfterSeconds: 59 });
    expect(await consume('k', at(59.5))).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(await consume('k', at(60))).toEqual({ allowed: true });
  });

  it('5 lượt/giờ: lượt thứ sáu chờ tới khi lượt cũ nhất rời cửa sổ (AC3)', async () => {
    for (let i = 0; i < 5; i++) expect(await consume('k', at(i * 100))).toEqual({ allowed: true });
    expect(await consume('k', at(500))).toEqual({ allowed: false, retryAfterSeconds: 3_100 });
    expect(await consume('k', at(3_600))).toEqual({ allowed: true });
  });

  it('lượt bị từ chối không được tính; key khác nhau độc lập', async () => {
    await consume('a', at(0));
    await consume('a', at(1));
    await consume('a', at(2));
    expect(await hitCount('a')).toBe(1);
    expect(await consume('b', at(2))).toEqual({ allowed: true });
  });

  it('transaction rollback → lượt không được tính', async () => {
    await expect(
      uow.run(async (tx) => {
        await limiter.consume(tx, 'r', OTP_REQUEST_LIMITS, at(0));
        throw new Error('bước sau lỗi');
      }),
    ).rejects.toThrow('bước sau lỗi');
    expect(await consume('r', at(1))).toEqual({ allowed: true });
  });

  it('dọn các lượt đã ra khỏi cửa sổ lớn nhất', async () => {
    await consume('c', at(0));
    await consume('c', at(100));
    await consume('c', at(3_650));
    expect(await hitCount('c')).toBe(2);
  });

  it('20 request đồng thời cùng key → đúng 1 lượt được phép (A10)', async () => {
    const results = await runConcurrently(20, () => consume('race', at(0)));
    const decisions = results.map((r) => (r.status === 'fulfilled' ? r.value.allowed : 'rejected'));
    expect(decisions.filter((d) => d === true)).toHaveLength(1);
    expect(decisions.filter((d) => d === false)).toHaveLength(19);
    expect(await hitCount('race')).toBe(1);
  });
});
