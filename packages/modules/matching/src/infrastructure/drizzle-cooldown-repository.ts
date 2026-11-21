import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { CooldownRepository } from '../application/ports/cooldown-repository.js';
import { cooldowns } from './schema-slots.js';

/** Hiện thực `CooldownRepository` trên `matching.cooldowns` (một dòng / người dùng). */
export class DrizzleCooldownRepository implements CooldownRepository {
  async isCooling(tx: Tx, userId: string, now: Date): Promise<boolean> {
    const [row] = await asDbTx(tx)
      .select({ userId: cooldowns.userId })
      .from(cooldowns)
      .where(and(eq(cooldowns.userId, userId), gt(cooldowns.until, now)));
    return row !== undefined;
  }

  /** Upsert giữ `until` lớn hơn (`GREATEST`) — gọi lại không rút ngắn cooldown, an toàn khi chạy đồng thời. */
  async start(tx: Tx, userId: string, until: Date, now: Date): Promise<void> {
    await asDbTx(tx)
      .insert(cooldowns)
      .values({ userId, until, updatedAt: now })
      .onConflictDoUpdate({
        target: cooldowns.userId,
        set: {
          until: sql`greatest(${cooldowns.until}, excluded.until)`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}
