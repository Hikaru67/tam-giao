import { registerErrors } from '../errors.js';

/** Mã lỗi của module identity. `RATE_LIMITED`, `UNAUTHENTICATED`, `FORBIDDEN` dùng mã chung (`common`). */
export const IDENTITY_ERROR_CODES = registerErrors('identity', {
  PHONE_INVALID: { status: 422, title: 'Số điện thoại không hợp lệ' },
  OTP_INVALID: { status: 422, title: 'Mã OTP không đúng' },
  OTP_EXPIRED: { status: 410, title: 'Mã OTP đã hết hạn' },
  OTP_LOCKED: { status: 429, title: 'Nhập sai OTP quá số lần cho phép, vui lòng yêu cầu mã mới' },
  TOKEN_EXPIRED: { status: 401, title: 'Token đã hết hạn' },
  TOKEN_REUSED: {
    status: 401,
    title: 'Refresh token đã được dùng, phiên bị thu hồi — vui lòng đăng nhập lại',
  },
});
