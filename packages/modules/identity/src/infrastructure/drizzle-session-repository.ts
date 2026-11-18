import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { SessionRepository } from '../application/ports/session-repository.js';
import {
  Session,
  type RefreshTokenId,
  type RefreshTokenRecord,
  type SessionId,
  type SessionRevokeReason,
} from '../domain/session.js';
import type { UserId } from '../domain/user.js';
import { refreshTokens, sessions } from './schema.js';

const toSession = (row: typeof sessions.$inferSelect): Session =>
  Session.restore({
    id: row.id as SessionId,
    userId: row.userId as UserId,
    deviceName: row.deviceName,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    revokeReason: row.revokeReason as SessionRevokeReason | null,
  });

export class DrizzleSessionRepository implements SessionRepository {
  async findById(tx: Tx, id: SessionId): Promise<Session | null> {
    const [row] = await asDbTx(tx).select().from(sessions).where(eq(sessions.id, id));
    return row ? toSession(row) : null;
  }

  async listActiveByUser(tx: Tx, userId: UserId): Promise<Session[]> {
    const rows = await asDbTx(tx)
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.lastUsedAt));
    return rows.map(toSession);
  }

  async save(tx: Tx, session: Session): Promise<void> {
    const s = session.toState();
    const mutable = { lastUsedAt: s.lastUsedAt, revokedAt: s.revokedAt, revokeReason: s.revokeReason };
    await asDbTx(tx)
      .insert(sessions)
      .values({ id: s.id, userId: s.userId, deviceName: s.deviceName, createdAt: s.createdAt, ...mutable })
      .onConflictDoUpdate({ target: sessions.id, set: mutable });
  }

  async findRefreshTokenForUpdate(tx: Tx, tokenHash: string): Promise<RefreshTokenRecord | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .for('update');
    if (!row) return null;
    return { ...row, id: row.id as RefreshTokenId, sessionId: row.sessionId as SessionId };
  }

  async addRefreshToken(tx: Tx, token: RefreshTokenRecord): Promise<void> {
    await asDbTx(tx).insert(refreshTokens).values(token);
  }

  async markRefreshTokenUsed(tx: Tx, id: RefreshTokenId, usedAt: Date): Promise<void> {
    await asDbTx(tx).update(refreshTokens).set({ usedAt }).where(eq(refreshTokens.id, id));
  }
}
