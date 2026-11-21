import type { DomainError, Result } from '@tamgiao/kernel';

/** Nội dung token partner (ký HMAC ở infrastructure). */
export interface PartnerTokenClaims {
  readonly staffId: string;
  readonly partnerId: string;
  /** `PartnerStaff.tokenVersion` lúc cấp — lệch với DB = token đã bị thu hồi. */
  readonly tokenVersion: number;
}

export interface IssuedPartnerToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/** Cấp / kiểm tra token partner ngắn hạn. Hạn so với `now` do caller truyền (lấy từ `Clock`). */
export interface PartnerTokenService {
  issue(claims: PartnerTokenClaims, now: Date, ttlSeconds: number): IssuedPartnerToken;
  /** Sai định dạng / sai chữ ký / hết hạn → `PARTNER_TOKEN_INVALID`. */
  verify(token: string, now: Date): Result<PartnerTokenClaims, DomainError<'PARTNER_TOKEN_INVALID'>>;
}
