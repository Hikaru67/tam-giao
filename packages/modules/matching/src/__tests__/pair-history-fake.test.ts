import { newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { orderPair } from '../application/ports/pair-history-repository.js';
import { FAKE_TX, InMemoryPairHistoryRepository } from './slot-fakes.js';

const T0 = new Date('2026-11-21T03:00:00.000Z');

describe('orderPair', () => {
  it('normalizes to [low, high] lowercase regardless of order', () => {
    const a = '0193a000-0000-7000-8000-00000000000A';
    const b = '0193a000-0000-7000-8000-00000000000b';
    expect(orderPair(b, a)).toEqual([a.toLowerCase(), b]);
    expect(orderPair(a, b)).toEqual([a.toLowerCase(), b]);
  });

  it('throws for the same user on both sides', () => {
    const a = newId();
    expect(() => orderPair(a, a.toUpperCase())).toThrow();
  });
});

describe('InMemoryPairHistoryRepository', () => {
  it('records unordered pairs and overwrites the last outcome', async () => {
    const repo = new InMemoryPairHistoryRepository();
    const [a, b, c, m1, m2] = [newId(), newId(), newId(), newId(), newId()];

    await repo.record(FAKE_TX, a, b, 'DECLINED', m1, T0);
    expect(await repo.hasTried(FAKE_TX, b, a)).toBe(true);
    expect(await repo.hasTried(FAKE_TX, a, c)).toBe(false);

    await repo.record(FAKE_TX, b, a, 'EXPIRED', m2, T0);
    expect(repo.entries.size).toBe(1);
    expect(repo.get(a, b)).toEqual({ outcome: 'EXPIRED', matchId: m2, updatedAt: T0 });
  });

  it('rejects an empty outcome', async () => {
    await expect(
      new InMemoryPairHistoryRepository().record(FAKE_TX, newId(), newId(), '', newId(), T0),
    ).rejects.toThrow();
  });
});
