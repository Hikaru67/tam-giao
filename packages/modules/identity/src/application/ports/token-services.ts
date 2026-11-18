import type { DomainError, Result } from '@tamgiao/kernel';

export interface AccessTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
}

export type AccessTokenError = DomainError<'UNAUTHENTICATED' | 'TOKEN_EXPIRED'>;

/** Phát và kiểm tra access token (JWT ký bằng khoá của server). Thời gian do caller truyền vào (port `Clock`). */
export interface AccessTokenService {
  issue(claims: AccessTokenClaims, now: Date, ttlSeconds: number): string;
  /** Sai chữ ký/định dạng → `UNAUTHENTICATED`; đúng chữ ký nhưng quá hạn → `TOKEN_EXPIRED`. */
  verify(token: string, now: Date): Result<AccessTokenClaims, AccessTokenError>;
}

/** Sinh refresh token ngẫu nhiên (entropy cao) và băm để lưu DB. */
export interface RefreshTokenSecrets {
  generate(): string;
  hash(token: string): string;
}
