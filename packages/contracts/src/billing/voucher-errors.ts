import { registerErrors } from '../errors.js';

/**
 * Mã lỗi voucher QR & đổi voucher tại quán (BE-S4-05). Các mã `VOUCHER_NOT_ACTIVE`, `VOUCHER_ALREADY_REDEEMED`,
 * `VOUCHER_EXPIRED`, `VOUCHER_PARTNER_MISMATCH` đã đăng ký ở `billing/errors.ts` (BE-S4-01) — không đăng ký lại.
 */
export const VOUCHER_ERROR_CODES = registerErrors('billing', {
  /** Voucher không tồn tại hoặc không thuộc người dùng đang đăng nhập (không lộ voucher của người khác). */
  VOUCHER_NOT_FOUND: { status: 404, title: 'Không tìm thấy voucher' },
  /** Token QR sai định dạng, bị sửa (sai chữ ký) hoặc đã hết hạn — app cần làm mới mã QR. */
  VOUCHER_TOKEN_INVALID: { status: 422, title: 'Mã QR voucher không hợp lệ hoặc đã hết hạn' },
});
