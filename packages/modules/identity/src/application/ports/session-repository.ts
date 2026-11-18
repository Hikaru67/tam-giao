import type { Tx } from '@tamgiao/kernel';
import type { RefreshTokenId, RefreshTokenRecord, Session, SessionId } from '../../domain/session.js';
import type { UserId } from '../../domain/user.js';

export interface SessionRepository {
  findById(tx: Tx, id: SessionId): Promise<Session | null>;
  /** Phiên chưa thu hồi của user, mới dùng nhất trước. */
  listActiveByUser(tx: Tx, userId: UserId): Promise<Session[]>;
  /** Thêm mới hoặc cập nhật phiên. */
  save(tx: Tx, session: Session): Promise<void>;

  /** Đọc và **khoá dòng** refresh token theo hash tới hết `tx` — hai lần refresh cùng token phải chạy tuần tự. */
  findRefreshTokenForUpdate(tx: Tx, tokenHash: string): Promise<RefreshTokenRecord | null>;
  addRefreshToken(tx: Tx, token: RefreshTokenRecord): Promise<void>;
  markRefreshTokenUsed(tx: Tx, id: RefreshTokenId, usedAt: Date): Promise<void>;
}
