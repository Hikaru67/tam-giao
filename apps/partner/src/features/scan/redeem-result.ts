import { isApiError } from '@tamgiao/api-client';

export type RedeemOutcome =
  | 'success'
  | 'already_redeemed'
  | 'expired'
  | 'wrong_partner'
  | 'invalid_code'
  | 'not_active'
  | 'network'
  | 'unknown';

/**
 * Phân loại kết quả đổi voucher từ lỗi trả về.
 * Hàm thuần tuý, dễ kiểm thử.
 */
export function redeemOutcome(error: unknown | null): RedeemOutcome {
  if (error === null || error === undefined) {
    return 'success';
  }

  if (!isApiError(error)) {
    // Mã quét được không đúng dạng token (vd QR khác, quá dài) bị schema contract chặn trước khi gửi.
    return error instanceof Error && error.name.includes('ZodError') ? 'invalid_code' : 'unknown';
  }

  switch (error.code) {
    case 'VOUCHER_ALREADY_REDEEMED':
      return 'already_redeemed';
    case 'VOUCHER_EXPIRED':
      return 'expired';
    case 'VOUCHER_PARTNER_MISMATCH':
      return 'wrong_partner';
    case 'VOUCHER_TOKEN_INVALID':
    case 'VOUCHER_NOT_FOUND':
      return 'invalid_code';
    case 'VOUCHER_NOT_ACTIVE':
      return 'not_active';
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return 'network';
    default:
      // 5xx: không biết BE đã đổi xong chưa → cho gửi lại cùng mã như lỗi mạng.
      if (error.status === 0 || error.status >= 500) {
        return 'network';
      }
      return 'unknown';
  }
}
