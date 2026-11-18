import { asDbTx } from '@tamgiao/db';
import type { Encryptor, Tx } from '@tamgiao/kernel';
import { eq } from 'drizzle-orm';
import type { AdminSessionRepository, AdminUserRepository } from '../application/ports/admin-repositories.js';
import { AdminSession, type AdminSessionId } from '../domain/admin-session.js';
import { AdminEmail, AdminUser, type AdminUserId } from '../domain/admin-user.js';
import { isAdminRole } from '../domain/permissions.js';
import { adminSessions, adminUsers } from './schema.js';

const totpContext = (adminId: string) => `identity.admin_users.totp_secret:${adminId}`;

export class DrizzleAdminUserRepository implements AdminUserRepository {
  constructor(private readonly encryptor: Encryptor) {}

  async findByEmailForUpdate(tx: Tx, email: AdminEmail): Promise<AdminUser | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email.value))
      .for('update');
    return row ? this.toDomain(row) : null;
  }

  async findById(tx: Tx, id: AdminUserId): Promise<AdminUser | null> {
    const [row] = await asDbTx(tx).select().from(adminUsers).where(eq(adminUsers.id, id));
    return row ? this.toDomain(row) : null;
  }

  async insert(tx: Tx, admin: AdminUser): Promise<boolean> {
    const s = admin.toState();
    const inserted = await asDbTx(tx)
      .insert(adminUsers)
      .values({
        id: s.id,
        email: s.email.value,
        passwordHash: s.passwordHash,
        totpSecretEnc: await this.encryptor.encrypt(s.totpSecret, totpContext(s.id)),
        role: s.role,
        failedLogins: s.failedLogins,
        lockedUntil: s.lockedUntil,
        lastTotpStep: s.lastTotpStep,
        createdAt: s.createdAt,
      })
      .onConflictDoNothing({ target: adminUsers.email })
      .returning({ id: adminUsers.id });
    return inserted.length === 1;
  }

  async update(tx: Tx, admin: AdminUser): Promise<void> {
    const s = admin.toState();
    await asDbTx(tx)
      .update(adminUsers)
      .set({ failedLogins: s.failedLogins, lockedUntil: s.lockedUntil, lastTotpStep: s.lastTotpStep })
      .where(eq(adminUsers.id, s.id));
  }

  private async toDomain(row: typeof adminUsers.$inferSelect): Promise<AdminUser> {
    const email = AdminEmail.parse(row.email);
    if (email.isErr() || !isAdminRole(row.role)) {
      throw new Error(`identity.admin_users ${row.id}: dữ liệu trong DB không hợp lệ`);
    }
    return AdminUser.restore({
      id: row.id as AdminUserId,
      email: email.value,
      passwordHash: row.passwordHash,
      totpSecret: await this.encryptor.decrypt(row.totpSecretEnc, totpContext(row.id)),
      role: row.role,
      failedLogins: row.failedLogins,
      lockedUntil: row.lockedUntil,
      lastTotpStep: row.lastTotpStep,
      createdAt: row.createdAt,
    });
  }
}

export class DrizzleAdminSessionRepository implements AdminSessionRepository {
  async findByTokenHash(tx: Tx, tokenHash: string): Promise<AdminSession | null> {
    const [row] = await asDbTx(tx).select().from(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
    if (!row) return null;
    return AdminSession.restore({
      ...row,
      id: row.id as AdminSessionId,
      adminId: row.adminId as AdminUserId,
    });
  }

  async save(tx: Tx, session: AdminSession): Promise<void> {
    const s = session.toState();
    await asDbTx(tx)
      .insert(adminSessions)
      .values(s)
      .onConflictDoUpdate({ target: adminSessions.id, set: { revokedAt: s.revokedAt } });
  }
}
