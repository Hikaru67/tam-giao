import type { DomainError, Result } from '@tamgiao/kernel';
import type { VoucherId } from '../../domain/voucher.js';

export interface IssuedVoucherQrToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Cấp / kiểm tra token QR voucher (ký HMAC ở infrastructure). Token chỉ chứa id voucher + hạn — không PII.
 * Hạn so với `now` do caller truyền (lấy từ `Clock`, A7).
 */
export interface VoucherQrTokenService {
  issue(voucherId: VoucherId, now: Date, ttlSeconds: number): IssuedVoucherQrToken;
  /** Sai định dạng / bị sửa (sai chữ ký) / hết hạn → `VOUCHER_TOKEN_INVALID`. */
  verify(token: string, now: Date): Result<VoucherId, DomainError<'VOUCHER_TOKEN_INVALID'>>;
}
