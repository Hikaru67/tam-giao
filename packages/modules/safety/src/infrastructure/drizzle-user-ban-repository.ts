import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import type { UserBanRepository } from '../application/ports/user-ban-repository.js';
import type { UserBan } from '../domain/user-ban.js';
import { userBans } from './schema.js';

/**
 * Hiện thực `UserBanRepository` trên `safety.user_bans` + outbox. `insert` dùng `ON CONFLICT (user_id) DO NOTHING`:
 * hai admin khoá đồng thời → transaction sau chờ transaction trước commit rồi không chèn được dòng nào → `false`,
 * không ghi outbox (A10).
 */
export class DrizzleUserBanRepository implements UserBanRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async insert(tx: Tx, ban: UserBan): Promise<boolean> {
    const s = ban.toState();
    const inserted = await asDbTx(tx)
      .insert(userBans)
      .values({
        userId: s.userId,
        id: s.id,
        reason: s.reason,
        reportId: s.reportId,
        bannedBy: s.bannedBy,
        bannedAt: s.bannedAt,
        version: s.version,
      })
      .onConflictDoNothing({ target: userBans.userId })
      .returning({ id: userBans.id });
    if (inserted.length === 0) return false;
    await this.outbox.append(tx, ban.pullEvents());
    return true;
  }
}
