import { MATCHING_SLOT_ERROR_CODES, errorRegistry } from '@tamgiao/contracts';
import { newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { FAKE_TX, InMemoryActiveSlotRepository } from './slot-fakes.js';

const NOW = new Date('2026-11-21T03:00:00.000Z');

describe('InMemoryActiveSlotRepository', () => {
  it('claims all users or none; busy user ids in details', async () => {
    const repo = new InMemoryActiveSlotRepository();
    const [a, b, c, m1, m2] = [newId(), newId(), newId(), newId(), newId()];

    expect((await repo.claim(FAKE_TX, [a, b], m1, NOW)).isOk()).toBe(true);
    const busy = await repo.claim(FAKE_TX, [c, b], m2, NOW);

    expect(busy.isErr() && busy.error).toEqual({ code: 'USER_BUSY', details: { userIds: [b] } });
    expect(repo.holderOf(c)).toBeUndefined();
    expect(repo.holderOf(b)).toBe(m1);
  });

  it('is idempotent for the same match and throws on empty input', async () => {
    const repo = new InMemoryActiveSlotRepository();
    const [a, b, m] = [newId(), newId(), newId()];
    await repo.claim(FAKE_TX, [a, b], m, NOW);
    expect((await repo.claim(FAKE_TX, [b, a], m, NOW)).isOk()).toBe(true);
    await expect(repo.claim(FAKE_TX, [], m, NOW)).rejects.toThrow();
  });

  it('release frees only the given match and is idempotent', async () => {
    const repo = new InMemoryActiveSlotRepository();
    const [a, b, c, d, m1, m2, m3] = [newId(), newId(), newId(), newId(), newId(), newId(), newId()];
    await repo.claim(FAKE_TX, [a, b], m1, NOW);
    await repo.claim(FAKE_TX, [c, d], m2, NOW);

    await repo.release(FAKE_TX, m1);
    await repo.release(FAKE_TX, m1);

    expect(repo.holderOf(c)).toBe(m2);
    expect((await repo.claim(FAKE_TX, [a, b], m3, NOW)).isOk()).toBe(true);
  });

  it('slot error codes are registered in contracts', () => {
    expect(MATCHING_SLOT_ERROR_CODES).toEqual(['USER_BUSY', 'USER_COOLING_DOWN', 'PAIR_ALREADY_TRIED']);
    expect(errorRegistry.get('USER_BUSY')).toMatchObject({ status: 409, owner: 'matching' });
  });
});
