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
  INVALID_CREDENTIALS: { status: 401, title: 'Email, mật khẩu hoặc mã xác thực không đúng' },
  MFA_REQUIRED: { status: 401, title: 'Cần nhập mã xác thực 2 lớp (TOTP)' },
  ADMIN_LOCKED: { status: 429, title: 'Tài khoản tạm khoá do đăng nhập sai nhiều lần' },
  PASSWORD_TOO_WEAK: { status: 422, title: 'Mật khẩu quá ngắn' },
  ADMIN_EMAIL_TAKEN: { status: 409, title: 'Email admin đã tồn tại' },
});
