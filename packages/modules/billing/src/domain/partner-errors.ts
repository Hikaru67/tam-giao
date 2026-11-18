/**
 * Mã lỗi nghiệp vụ quán đối tác + nhân viên quán (BE-S4-06, AGENTS.md A4). Mỗi mã được đăng ký HTTP status ở
 * `@tamgiao/contracts` (`billing/partner-errors.ts`) — test `partner-domain.test.ts` kiểm tra điều này.
 */
export const PARTNER_ERRORS = [
  'PARTNER_NOT_FOUND',
  'PARTNER_STAFF_NOT_FOUND',
  'PARTNER_INVALID',
  'PARTNER_PIN_INVALID',
  'PARTNER_LOGIN_FAILED',
  'PARTNER_STAFF_LOCKED',
  'PARTNER_INACTIVE',
  'PARTNER_TOKEN_INVALID',
] as const;

export type PartnerErrorCode = (typeof PARTNER_ERRORS)[number];
