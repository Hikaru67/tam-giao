import { COOLDOWN_DAYS } from '@tamgiao/contracts/constants';
import { addDuration, FakeClock, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { FAKE_TX, InMemoryCooldownRepository } from './slot-fakes.js';

const T0 = new Date('2026-11-21T03:00:00.000Z');
const UNTIL = addDuration(T0, { days: COOLDOWN_DAYS });

describe('InMemoryCooldownRepository', () => {
  it('is cooling while now < until, not at until', async () => {
    const repo = new InMemoryCooldownRepository();
    const clock = new FakeClock(T0);
    const user = newId();
    expect(await repo.isCooling(FAKE_TX, user, clock.now())).toBe(false);

    await repo.start(FAKE_TX, user, UNTIL, clock.now());

    expect(await repo.isCooling(FAKE_TX, user, clock.now())).toBe(true);
    clock.set(new Date(UNTIL.getTime() - 1));
    expect(await repo.isCooling(FAKE_TX, user, clock.now())).toBe(true);
    clock.set(UNTIL);
    expect(await repo.isCooling(FAKE_TX, user, clock.now())).toBe(false);
  });

  it('starting again keeps the later until', async () => {
    const repo = new InMemoryCooldownRepository();
    const user = newId();
    const later = addDuration(UNTIL, { days: 2 });
    await repo.start(FAKE_TX, user, later, T0);
    await repo.start(FAKE_TX, user, UNTIL, T0);
    expect(await repo.isCooling(FAKE_TX, user, UNTIL)).toBe(true);
    expect(await repo.isCooling(FAKE_TX, user, later)).toBe(false);
  });
});
