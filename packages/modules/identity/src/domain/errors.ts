/**
 * Mã lỗi nghiệp vụ của module identity (AGENTS.md A4). Mỗi mã phải được đăng ký HTTP status ở
 * `@tamgiao/contracts` (`identity/errors.ts` hoặc mã chung) — test `errors.test.ts` kiểm tra điều này.
 */
export const IDENTITY_ERRORS = [
  'PHONE_INVALID',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_LOCKED',
  'RATE_LIMITED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'TOKEN_REUSED',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'FORBIDDEN',
  'INVALID_CREDENTIALS',
  'MFA_REQUIRED',
  'ADMIN_LOCKED',
  'PASSWORD_TOO_WEAK',
  'ADMIN_EMAIL_TAKEN',
  'AUDIT_ENTRY_INVALID',
] as const;

export type IdentityErrorCode = (typeof IDENTITY_ERRORS)[number];
