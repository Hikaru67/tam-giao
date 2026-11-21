import { asDbTx } from '@tamgiao/db';
import { fail, ok, type DomainError, type Result, type Tx } from '@tamgiao/kernel';
import { and, eq, inArray } from 'drizzle-orm';
import type { ActiveSlotRepository } from '../application/ports/active-slot-repository.js';
import { activeSlots } from './schema-slots.js';

/**
 * Hiện thực `ActiveSlotRepository` trên `matching.active_slots` (`user_id` PK = độc quyền 1-1, A10).
 *
 * Dùng `INSERT … ON CONFLICT (user_id) DO NOTHING RETURNING` thay vì bắt lỗi 23505: vi phạm unique làm transaction
 * Postgres bị abort, còn `DO NOTHING` vẫn để `tx` của caller dùng tiếp được (không cần SAVEPOINT). Khi hai transaction
 * cùng chèn một `user_id`, transaction sau chờ transaction trước kết thúc: trước commit → bỏ qua dòng (bận); trước
 * rollback → chèn được. Dòng được chèn theo thứ tự uuid tăng dần để các transaction luôn lấy khoá cùng thứ tự (tránh
 * deadlock khi claim chéo, vd [A, B] và [B, A]).
 */
export class DrizzleActiveSlotRepository implements ActiveSlotRepository {
  async claim(
    tx: Tx,
    userIds: readonly string[],
    matchId: string,
    now: Date,
  ): Promise<Result<void, DomainError<'USER_BUSY'>>> {
    const users = [...new Set(userIds.map((id) => id.toLowerCase()))].sort();
    if (users.length === 0) throw new Error('active_slots.claim: userIds rỗng');
    const db = asDbTx(tx);

    const inserted = await db
      .insert(activeSlots)
      .values(users.map((userId) => ({ userId, matchId, claimedAt: now })))
      .onConflictDoNothing({ target: activeSlots.userId })
      .returning({ userId: activeSlots.userId });
    if (inserted.length === users.length) return ok();

    const insertedIds = new Set(inserted.map((r) => r.userId));
    const conflicted = users.filter((id) => !insertedIds.has(id));
    const holders = await db
      .select({ userId: activeSlots.userId, matchId: activeSlots.matchId })
      .from(activeSlots)
      .where(inArray(activeSlots.userId, conflicted));
    // Dòng của chính `matchId` (claim lặp lại) không tính là bận. Dòng biến mất giữa chừng (vừa được release) vẫn
    // tính là bận cho lần này — caller thử lại.
    const busy = conflicted.filter((id) => holders.find((h) => h.userId === id)?.matchId !== matchId);
    if (busy.length === 0) return ok();

    // Tất cả hoặc không: gỡ các slot vừa giữ trong lần gọi này.
    if (insertedIds.size > 0) {
      await db
        .delete(activeSlots)
        .where(and(eq(activeSlots.matchId, matchId), inArray(activeSlots.userId, [...insertedIds])));
    }
    return fail('USER_BUSY', { userIds: busy });
  }

  async release(tx: Tx, matchId: string): Promise<void> {
    await asDbTx(tx).delete(activeSlots).where(eq(activeSlots.matchId, matchId));
  }
}
