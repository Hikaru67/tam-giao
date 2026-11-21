import { createDatabase, DrizzleUnitOfWork, type Database } from '@tamgiao/db';
import { newId, ok, type DomainError, type Result } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleActiveSlotRepository } from '../infrastructure/drizzle-active-slot-repository.js';

const NOW = new Date('2026-11-21T03:00:00.000Z');
const ITERATIONS = 50;

let database: Database;
let uow: DrizzleUnitOfWork;
const repo = new DrizzleActiveSlotRepository();

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
});
beforeEach(() => resetDatabase(database.pool));
afterAll(() => database.close());

type ClaimResult = Result<void, DomainError<'USER_BUSY'>>;

const claim = (userIds: string[], matchId: string): Promise<ClaimResult> =>
  uow.run((tx) => repo.claim(tx, userIds, matchId, NOW));

const release = (matchId: string) =>
  uow.run(async (tx) => {
    await repo.release(tx, matchId);
    return ok();
  });

async function slotsOf(matchId: string): Promise<string[]> {
  const { rows } = await database.pool.query<{ user_id: string }>(
    'select user_id from matching.active_slots where match_id = $1 order by user_id',
    [matchId],
  );
  return rows.map((r) => r.user_id);
}

function settledValues(results: PromiseSettledResult<ClaimResult>[]): ClaimResult[] {
  return results.map((r) => {
    if (r.status === 'rejected') throw r.reason;
    return r.value;
  });
}

describe('DrizzleActiveSlotRepository', () => {
  it('claims slots for every user of the match', async () => {
    const [a, b, m] = [newId(), newId(), newId()];
    expect((await claim([a, b], m)).isOk()).toBe(true);
    expect(await slotsOf(m)).toEqual([a, b].sort());
  });

  it('returns USER_BUSY with the busy user ids and keeps nothing (all or nothing)', async () => {
    const [a, b, c, m1, m2] = [newId(), newId(), newId(), newId(), newId()];
    await claim([a, b], m1);

    const result = await claim([c, b], m2);

    expect(result.isErr() && result.error).toEqual({ code: 'USER_BUSY', details: { userIds: [b] } });
    expect(await slotsOf(m2)).toEqual([]);
    expect(await slotsOf(m1)).toEqual([a, b].sort());
  });

  it('keeps the caller transaction usable after USER_BUSY', async () => {
    const [a, b, c, d, m1, m2, m3] = [newId(), newId(), newId(), newId(), newId(), newId(), newId()];
    await claim([a, b], m1);

    const result = await uow.run(async (tx) => {
      const busy = await repo.claim(tx, [a, c], m2, NOW);
      expect(busy.isErr()).toBe(true);
      return repo.claim(tx, [c, d], m3, NOW);
    });

    expect(result.isOk()).toBe(true);
    expect(await slotsOf(m3)).toEqual([c, d].sort());
    expect(await slotsOf(m2)).toEqual([]);
  });

  it('is idempotent when the same match claims again', async () => {
    const [a, b, m] = [newId(), newId(), newId()];
    await claim([a, b], m);
    expect((await claim([b, a], m)).isOk()).toBe(true);
    expect(await slotsOf(m)).toEqual([a, b].sort());
  });

  it('throws on an empty user list (programming error)', async () => {
    await expect(claim([], newId())).rejects.toThrow('userIds');
  });

  it('AC2: release frees the slots so the users can be claimed again; release is idempotent', async () => {
    const [a, b, m1, m2] = [newId(), newId(), newId(), newId()];
    await claim([a, b], m1);
    expect((await claim([a, b], m2)).isErr()).toBe(true);

    await release(m1);
    await release(m1);

    expect(await slotsOf(m1)).toEqual([]);
    expect((await claim([a, b], m2)).isOk()).toBe(true);
    expect(await slotsOf(m2)).toEqual([a, b].sort());
  });

  it('release only frees the slots of the given match', async () => {
    const [a, b, c, d, m1, m2] = [newId(), newId(), newId(), newId(), newId(), newId()];
    await claim([a, b], m1);
    await claim([c, d], m2);

    await release(m1);

    expect(await slotsOf(m2)).toEqual([c, d].sort());
  });

  describe('AC1: concurrency (A10)', () => {
    it(`two concurrent claims of the same user → exactly one wins (${ITERATIONS} runs)`, async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const shared = newId();
        const others = [newId(), newId()];
        const matches = [newId(), newId()];

        const results = settledValues(
          await runConcurrently(2, (k) => claim([shared, others[k]!], matches[k]!)),
        );

        const winners = results.filter((r) => r.isOk());
        const losers = results.filter((r) => r.isErr());
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect(losers[0]!.isErr() && losers[0]!.error).toEqual({
          code: 'USER_BUSY',
          details: { userIds: [shared] },
        });
        const winner = results.findIndex((r) => r.isOk());
        expect(await slotsOf(matches[winner]!)).toEqual([shared, others[winner]!].sort());
        expect(await slotsOf(matches[1 - winner]!)).toEqual([]);
      }
    });

    it(`cross claims A+B vs B+C → exactly one wins, C stays free (${ITERATIONS} runs)`, async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const [a, b, c] = [newId(), newId(), newId()];
        const pairs = [
          [a, b],
          [b, c],
        ];
        const matches = [newId(), newId()];

        const results = settledValues(await runConcurrently(2, (k) => claim(pairs[k]!, matches[k]!)));

        expect(results.filter((r) => r.isOk())).toHaveLength(1);
        const winner = results.findIndex((r) => r.isOk());
        const loser = results[1 - winner]!;
        expect(loser.isErr() && loser.error.details).toEqual({ userIds: [b] });
        expect(await slotsOf(matches[winner]!)).toEqual([...pairs[winner]!].sort());
        expect(await slotsOf(matches[1 - winner]!)).toEqual([]);
      }
    });

    it(`reversed claims A+B vs B+A do not deadlock (${ITERATIONS} runs)`, async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const [a, b] = [newId(), newId()];
        const pairs = [
          [a, b],
          [b, a],
        ];
        const matches = [newId(), newId()];

        const results = settledValues(await runConcurrently(2, (k) => claim(pairs[k]!, matches[k]!)));

        expect(results.filter((r) => r.isOk())).toHaveLength(1);
        expect(results.filter((r) => r.isErr())).toHaveLength(1);
      }
    });
  });
});
