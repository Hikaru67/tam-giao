import { COOLDOWN_DAYS } from '@tamgiao/contracts/constants';
import { createDatabase, DrizzleUnitOfWork, type Database } from '@tamgiao/db';
import { addDuration, FakeClock, newId, ok } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleCooldownRepository } from '../infrastructure/drizzle-cooldown-repository.js';

const T0 = new Date('2026-11-21T03:00:00.000Z');
const UNTIL = addDuration(T0, { days: COOLDOWN_DAYS });

let database: Database;
let uow: DrizzleUnitOfWork;
const repo = new DrizzleCooldownRepository();
const clock = new FakeClock(T0);

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
});
beforeEach(async () => {
  await resetDatabase(database.pool);
  clock.set(T0);
});
afterAll(() => database.close());

const start = (userId: string, until: Date) =>
  uow.run(async (tx) => {
    await repo.start(tx, userId, until, clock.now());
    return ok();
  });

const isCooling = async (userId: string, now: Date) => {
  const r = await uow.run(async (tx) => ok(await repo.isCooling(tx, userId, now)));
  return r.isOk() && r.value;
};

describe('DrizzleCooldownRepository', () => {
  it('a user without cooldown is not cooling', async () => {
    expect(await isCooling(newId(), T0)).toBe(false);
  });

  it('AC3: cooling until exactly `until` (now < until)', async () => {
    const user = newId();
    await start(user, UNTIL);

    expect(await isCooling(user, T0)).toBe(true);
    expect(await isCooling(user, new Date(UNTIL.getTime() - 1))).toBe(true);
    expect(await isCooling(user, UNTIL)).toBe(false);
    expect(await isCooling(user, new Date(UNTIL.getTime() + 1))).toBe(false);
  });

  it('AC3: follows the FakeClock across the boundary', async () => {
    const user = newId();
    await start(user, UNTIL);

    clock.advance({ days: COOLDOWN_DAYS - 1 });
    expect(await isCooling(user, clock.now())).toBe(true);
    clock.set(UNTIL);
    expect(await isCooling(user, clock.now())).toBe(false);
  });

  it('starting again keeps the later `until` (never shortens a cooldown)', async () => {
    const user = newId();
    const later = addDuration(UNTIL, { days: 3 });
    await start(user, later);
    await start(user, UNTIL);

    expect(await isCooling(user, addDuration(UNTIL, { days: 1 }))).toBe(true);

    await start(user, addDuration(later, { days: 1 }));
    expect(await isCooling(user, later)).toBe(true);
  });

  it('only affects the given user', async () => {
    const [a, b] = [newId(), newId()];
    await start(a, UNTIL);
    expect(await isCooling(b, T0)).toBe(false);
  });

  it('concurrent starts keep the maximum `until`', async () => {
    const user = newId();
    const untils = Array.from({ length: 5 }, (_, i) => addDuration(UNTIL, { hours: i }));
    const results = await runConcurrently(untils.length, (i) => start(user, untils[i]!));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const { rows } = await database.pool.query<{ until: Date }>(
      'select until from matching.cooldowns where user_id = $1',
      [user],
    );
    expect(rows.map((r) => r.until.toISOString())).toEqual([untils[4]!.toISOString()]);
  });
});
