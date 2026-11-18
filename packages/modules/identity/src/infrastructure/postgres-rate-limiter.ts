import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import type { RateLimitDecision, RateLimiter } from '../application/ports/rate-limiter.js';
import type { RateLimitRule } from '../domain/otp-policy.js';
import { rateLimitHits } from './schema.js';

/**
 * Rate limiter cửa sổ trượt trên Postgres. Tuần tự hoá theo `key` bằng advisory lock mức transaction,
 * nên hai request đồng thời cùng key không thể cùng lọt qua giới hạn. Lượt cũ hơn cửa sổ lớn nhất được dọn ngay tại đây.
 */
export class PostgresRateLimiter implements RateLimiter {
  async consume(tx: Tx, key: string, rules: readonly RateLimitRule[], now: Date): Promise<RateLimitDecision> {
    const db = asDbTx(tx);
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);

    const nowMs = now.getTime();
    const longestWindowMs = Math.max(...rules.map((r) => r.windowSeconds)) * 1_000;
    await db
      .delete(rateLimitHits)
      .where(and(eq(rateLimitHits.key, key), lte(rateLimitHits.hitAt, new Date(nowMs - longestWindowMs))));

    const hits = await db
      .select({ hitAt: rateLimitHits.hitAt })
      .from(rateLimitHits)
      .where(eq(rateLimitHits.key, key))
      .orderBy(desc(rateLimitHits.hitAt));

    let retryAtMs = 0;
    for (const rule of rules) {
      const windowMs = rule.windowSeconds * 1_000;
      const inWindow = hits.filter((h) => h.hitAt.getTime() > nowMs - windowMs);
      // Lượt mới nhất thứ `limit` rời cửa sổ thì mới còn chỗ cho lượt tiếp theo.
      const blocking = inWindow[rule.limit - 1];
      if (blocking) retryAtMs = Math.max(retryAtMs, blocking.hitAt.getTime() + windowMs);
    }
    if (retryAtMs > 0) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((retryAtMs - nowMs) / 1_000)) };
    }

    await db.insert(rateLimitHits).values({ key, hitAt: now });
    return { allowed: true };
  }
}
