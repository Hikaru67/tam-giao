/**
 * Mã QR voucher (BE-S4-05). Token QR chỉ chứa id voucher + hạn, ký HMAC ở infrastructure; hạn ngắn để ảnh chụp màn
 * hình mã QR không dùng lại được lâu — app làm mới trước khi hết hạn.
 */

/** Hạn token QR voucher (giây). Task cho phép 60–120s; chọn 90s để app làm mới mỗi ~60s vẫn còn dư cho lệch giờ. */
export const VOUCHER_QR_TOKEN_TTL_SECONDS = 90;

/**
 * Mã lỗi tầng application của voucher QR (A4) — đăng ký ở contracts `billing/voucher-errors.ts`.
 * Các mã lỗi chuyển trạng thái voucher nằm ở `BILLING_DOMAIN_ERRORS` (`errors.ts`).
 */
export const VOUCHER_QR_ERRORS = ['VOUCHER_NOT_FOUND', 'VOUCHER_TOKEN_INVALID'] as const;
export type VoucherQrErrorCode = (typeof VOUCHER_QR_ERRORS)[number];
