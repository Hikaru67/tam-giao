import { fail, ok, type DomainError, type Result, type Tx } from '@tamgiao/kernel';
import type { ActiveSlotRepository } from '../application/ports/active-slot-repository.js';
import type { CooldownRepository } from '../application/ports/cooldown-repository.js';
import { orderPair, type PairHistoryRepository } from '../application/ports/pair-history-repository.js';

/** Fake in-memory của `ActiveSlotRepository` cho unit test use case (cùng ngữ nghĩa với adapter Drizzle). */
export class InMemoryActiveSlotRepository implements ActiveSlotRepository {
  /** userId → matchId đang giữ slot. */
  readonly slots = new Map<string, { readonly matchId: string; readonly claimedAt: Date }>();

  async claim(
    _tx: Tx,
    userIds: readonly string[],
    matchId: string,
    now: Date,
  ): Promise<Result<void, DomainError<'USER_BUSY'>>> {
    const users = [...new Set(userIds.map((id) => id.toLowerCase()))].sort();
    if (users.length === 0) throw new Error('active_slots.claim: userIds rỗng');
    const busy = users.filter((id) => {
      const held = this.slots.get(id);
      return held !== undefined && held.matchId !== matchId;
    });
    if (busy.length > 0) return fail('USER_BUSY', { userIds: busy });
    for (const id of users) {
      if (!this.slots.has(id)) this.slots.set(id, { matchId, claimedAt: now });
    }
    return ok();
  }

  async release(_tx: Tx, matchId: string): Promise<void> {
    for (const [userId, slot] of this.slots) {
      if (slot.matchId === matchId) this.slots.delete(userId);
    }
  }

  /** Match mà người dùng đang giữ slot (tiện cho assert). */
  holderOf(userId: string): string | undefined {
    return this.slots.get(userId.toLowerCase())?.matchId;
  }
}

/** Fake in-memory của `CooldownRepository`. */
export class InMemoryCooldownRepository implements CooldownRepository {
  readonly untilByUser = new Map<string, Date>();

  async isCooling(_tx: Tx, userId: string, now: Date): Promise<boolean> {
    const until = this.untilByUser.get(userId.toLowerCase());
    return until !== undefined && now.getTime() < until.getTime();
  }

  async start(_tx: Tx, userId: string, until: Date, _now: Date): Promise<void> {
    const key = userId.toLowerCase();
    const current = this.untilByUser.get(key);
    if (current === undefined || until.getTime() > current.getTime()) this.untilByUser.set(key, until);
  }
}

export interface PairHistoryEntry {
  readonly outcome: string;
  readonly matchId: string;
  readonly updatedAt: Date;
}

/** Fake in-memory của `PairHistoryRepository`. */
export class InMemoryPairHistoryRepository implements PairHistoryRepository {
  /** Khoá `low|high`. */
  readonly entries = new Map<string, PairHistoryEntry>();

  async record(
    _tx: Tx,
    userA: string,
    userB: string,
    outcome: string,
    matchId: string,
    now: Date,
  ): Promise<void> {
    if (outcome.length === 0) throw new Error('pair_history.record: outcome rỗng');
    this.entries.set(pairKey(userA, userB), { outcome, matchId, updatedAt: now });
  }

  async hasTried(_tx: Tx, userA: string, userB: string): Promise<boolean> {
    return this.entries.has(pairKey(userA, userB));
  }

  get(userA: string, userB: string): PairHistoryEntry | undefined {
    return this.entries.get(pairKey(userA, userB));
  }
}

const pairKey = (userA: string, userB: string): string => orderPair(userA, userB).join('|');

/** `Tx` giả cho unit test dùng fake (fake không đọc `tx`). */
export const FAKE_TX = {} as Tx;
