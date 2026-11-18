import { registerErrors } from '../errors.js';

/** Mã lỗi quán đối tác + đăng nhập nhân viên quán (BE-S4-06). */
export const PARTNER_ERROR_CODES = registerErrors('billing', {
  PARTNER_NOT_FOUND: { status: 404, title: 'Không tìm thấy quán đối tác' },
  PARTNER_STAFF_NOT_FOUND: { status: 404, title: 'Không tìm thấy tài khoản nhân viên quán' },
  /** `meta.field`: trường không hợp lệ (`name`, `address`, `tags`). */
  PARTNER_INVALID: { status: 422, title: 'Thông tin quán đối tác không hợp lệ' },
  /** PIN nhân viên quán phải gồm đúng 6 chữ số. */
  PARTNER_PIN_INVALID: { status: 422, title: 'Mã PIN không hợp lệ' },
  /** Sai mã nhân viên, PIN hoặc thiết bị — không nói rõ sai phần nào. */
  PARTNER_LOGIN_FAILED: { status: 401, title: 'Đăng nhập nhân viên quán thất bại' },
  /** `meta.retryAfterSeconds`: sai PIN quá số lần cho phép, tài khoản bị khoá tạm thời. */
  PARTNER_STAFF_LOCKED: { status: 429, title: 'Tài khoản nhân viên quán tạm bị khoá' },
  /** Quán đã tắt hoặc tài khoản nhân viên đã bị vô hiệu hoá. */
  PARTNER_INACTIVE: { status: 403, title: 'Quán hoặc tài khoản nhân viên không còn hoạt động' },
  /** Token partner thiếu, sai chữ ký, hết hạn hoặc đã bị thu hồi (đổi PIN/thiết bị). */
  PARTNER_TOKEN_INVALID: { status: 401, title: 'Phiên nhân viên quán không hợp lệ hoặc đã hết hạn' },
});
