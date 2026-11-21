import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, eq, sql } from 'drizzle-orm';
import { orderPair, type PairHistoryRepository } from '../application/ports/pair-history-repository.js';
import { pairHistory } from './schema-slots.js';

/** Hiện thực `PairHistoryRepository` trên `matching.pair_history` (cặp chuẩn hoá `user_low < user_high`). */
export class DrizzlePairHistoryRepository implements PairHistoryRepository {
  async record(
    tx: Tx,
    userA: string,
    userB: string,
    outcome: string,
    matchId: string,
    now: Date,
  ): Promise<void> {
    if (outcome.length === 0) throw new Error('pair_history.record: outcome rỗng');
    const [userLow, userHigh] = orderPair(userA, userB);
    await asDbTx(tx)
      .insert(pairHistory)
      .values({ userLow, userHigh, lastOutcome: outcome, lastMatchId: matchId, updatedAt: now })
      .onConflictDoUpdate({
        target: [pairHistory.userLow, pairHistory.userHigh],
        set: {
          lastOutcome: sql`excluded.last_outcome`,
          lastMatchId: sql`excluded.last_match_id`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async hasTried(tx: Tx, userA: string, userB: string): Promise<boolean> {
    const [userLow, userHigh] = orderPair(userA, userB);
    const [row] = await asDbTx(tx)
      .select({ userLow: pairHistory.userLow })
      .from(pairHistory)
      .where(and(eq(pairHistory.userLow, userLow), eq(pairHistory.userHigh, userHigh)));
    return row !== undefined;
  }
}
