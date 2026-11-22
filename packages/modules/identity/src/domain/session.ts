import { Entity, addDuration, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';
import type { UserId } from './user.js';

export type SessionId = Id<'Session'>;
export type RefreshTokenId = Id<'RefreshToken'>;

/** Access token (JWT) sống 15 phút — BE-S2-02. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Refresh token hết hạn nếu không dùng trong 30 ngày (mỗi lần xoay được gia hạn lại). */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/**
 * `USER_BANNED`: tài khoản bị khoá vĩnh viễn (safety `UserBanned`, BE-S6-06).
 * `ACCOUNT_DELETED`: người dùng xoá tài khoản (BE-S7-06).
 */
export type SessionRevokeReason =
  'LOGOUT' | 'REVOKED_BY_USER' | 'REFRESH_TOKEN_REUSED' | 'USER_BANNED' | 'ACCOUNT_DELETED';

export interface SessionState {
  readonly id: SessionId;
  readonly userId: UserId;
  /** Tên thiết bị do app gửi lên (vd "iPhone 15") để hiển thị ở danh sách thiết bị. */
  readonly deviceName: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  readonly revokedAt: Date | null;
  readonly revokeReason: SessionRevokeReason | null;
}

/** Bản ghi refresh token: chỉ lưu hash; mỗi token dùng đúng một lần rồi được thay bằng token mới ("xoay vòng"). */
export interface RefreshTokenRecord {
  readonly id: RefreshTokenId;
  readonly sessionId: SessionId;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

export type RefreshError = DomainError<'UNAUTHENTICATED' | 'TOKEN_EXPIRED' | 'TOKEN_REUSED'>;

/**
 * Một phiên đăng nhập = một thiết bị = một "họ" refresh token.
 * Refresh token đã dùng mà bị đem dùng lại nghĩa là token đã lộ → thu hồi cả phiên.
 */
export class Session extends Entity<SessionId> {
  private constructor(private state: SessionState) {
    super(state.id);
  }

  static start(input: Pick<SessionState, 'id' | 'userId' | 'deviceName'>, now: Date): Session {
    return new Session({ ...input, createdAt: now, lastUsedAt: now, revokedAt: null, revokeReason: null });
  }

  static restore(state: SessionState): Session {
    return new Session(state);
  }

  get userId(): UserId {
    return this.state.userId;
  }

  get isActive(): boolean {
    return this.state.revokedAt === null;
  }

  /**
   * Dùng `token` để xoay vòng. `Err('TOKEN_REUSED')` đồng thời **thu hồi phiên** (state đổi → use case phải lưu).
   * `Ok` → use case đánh dấu token đã dùng và phát token mới.
   */
  rotate(token: RefreshTokenRecord, now: Date): Result<void, RefreshError> {
    if (token.sessionId !== this.id) throw new Error('refresh token không thuộc phiên này');
    if (!this.isActive) return fail('UNAUTHENTICATED');
    if (token.usedAt !== null) {
      this.revoke('REFRESH_TOKEN_REUSED', now);
      return fail('TOKEN_REUSED');
    }
    if (now.getTime() >= token.expiresAt.getTime()) return fail('TOKEN_EXPIRED');
    this.state = { ...this.state, lastUsedAt: now };
    return ok();
  }

  /** Idempotent: thu hồi phiên đã thu hồi không đổi gì. */
  revoke(reason: SessionRevokeReason, now: Date): void {
    if (!this.isActive) return;
    this.state = { ...this.state, revokedAt: now, revokeReason: reason };
  }

  toState(): SessionState {
    return this.state;
  }
}

export function newRefreshTokenRecord(
  input: Pick<RefreshTokenRecord, 'id' | 'sessionId' | 'tokenHash'>,
  now: Date,
): RefreshTokenRecord {
  return {
    ...input,
    createdAt: now,
    expiresAt: addDuration(now, { days: REFRESH_TOKEN_TTL_DAYS }),
    usedAt: null,
  };
}
