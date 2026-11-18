import { newId, type Tx } from '@tamgiao/kernel';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  Session,
  newRefreshTokenRecord,
  type RefreshTokenRecord,
} from '../domain/session.js';
import type { UserId } from '../domain/user.js';
import type { SessionRepository } from './ports/session-repository.js';
import type { AccessTokenService, RefreshTokenSecrets } from './ports/token-services.js';

export interface AuthTokens {
  readonly sessionId: string;
  readonly accessToken: string;
  readonly accessTokenExpiresInSeconds: number;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

/** Phát cặp access/refresh token. Dùng chung cho đăng nhập (mở phiên mới) và xoay vòng (phiên đang có). */
export class SessionIssuer {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshSecrets: RefreshTokenSecrets,
  ) {}

  async startSession(tx: Tx, userId: UserId, deviceName: string | null, now: Date): Promise<AuthTokens> {
    const session = Session.start({ id: newId<'Session'>(), userId, deviceName }, now);
    await this.sessions.save(tx, session);
    return this.issueTokens(tx, session, now);
  }

  /** Phát token mới cho phiên đã qua kiểm tra `Session.rotate` (caller tự lưu session và đánh dấu token cũ). */
  async issueTokens(tx: Tx, session: Session, now: Date): Promise<AuthTokens> {
    const refreshToken = this.refreshSecrets.generate();
    const record: RefreshTokenRecord = newRefreshTokenRecord(
      {
        id: newId<'RefreshToken'>(),
        sessionId: session.id,
        tokenHash: this.refreshSecrets.hash(refreshToken),
      },
      now,
    );
    await this.sessions.addRefreshToken(tx, record);
    return {
      sessionId: session.id,
      accessToken: this.accessTokens.issue(
        { userId: session.userId, sessionId: session.id },
        now,
        ACCESS_TOKEN_TTL_SECONDS,
      ),
      accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshTokenExpiresAt: record.expiresAt,
    };
  }
}
