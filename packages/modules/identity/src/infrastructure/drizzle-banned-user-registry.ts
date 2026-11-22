import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { eq } from 'drizzle-orm';
import type { BannedUserRegistry } from '../application/ports/banned-user-registry.js';
import { bannedUsers, deletedPhoneIndexes } from './schema.js';

/** `BannedUserRegistry` trên `identity.banned_users` (PK `user_id`, upsert không ghi đè → idempotent). */
export class DrizzleBannedUserRegistry implements BannedUserRegistry {
  async markBanned(tx: Tx, userId: string, bannedAt: Date): Promise<void> {
    await asDbTx(tx).insert(bannedUsers).values({ userId, bannedAt }).onConflictDoNothing();
  }

  async isBanned(tx: Tx, userId: string): Promise<boolean> {
    const [row] = await asDbTx(tx)
      .select({ userId: bannedUsers.userId })
      .from(bannedUsers)
      .where(eq(bannedUsers.userId, userId));
    return row !== undefined;
  }

  async isBannedDeletedPhone(tx: Tx, phoneBidx: string): Promise<boolean> {
    const [row] = await asDbTx(tx)
      .select({ userId: deletedPhoneIndexes.userId })
      .from(deletedPhoneIndexes)
      .innerJoin(bannedUsers, eq(bannedUsers.userId, deletedPhoneIndexes.userId))
      .where(eq(deletedPhoneIndexes.phoneBidx, phoneBidx))
      .limit(1);
    return row !== undefined;
  }
}
