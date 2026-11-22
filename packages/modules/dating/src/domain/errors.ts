/**
 * Mã lỗi nghiệp vụ của module dating (AGENTS.md A4, BE-S7-01).
 *
 * - `DATING_DOMAIN_ERRORS`: mã do dating sở hữu, đăng ký ở `@tamgiao/contracts` (`dating/errors.ts`).
 * - `DATING_REUSED_ERRORS`: mã đã được module khác đăng ký, dating dùng lại đúng nghĩa (registry cấm đăng ký trùng):
 *   `CANCEL_TOO_LATE` (verification), `NOT_PARTICIPANT` (matching), `PARTNER_NOT_FOUND` (billing), `NOT_FOUND`,
 *   `INVALID_ID` (common).
 *
 * Test `dating-contracts.test.ts` kiểm tra mọi mã đều có trong registry với đúng owner.
 */
export const DATING_DOMAIN_ERRORS = [
  'MATCH_NOT_DATING',
  'DATE_ALREADY_OPEN',
  'DATE_TIME_INVALID',
  'DATE_NOT_INVITEE',
  'DATE_RESPONSE_EXPIRED',
  'DATE_INVALID_TRANSITION',
  // BE-S7-02 — check-in an toàn
  'DATE_CHECK_IN_WINDOW_CLOSED',
  'DATE_ALREADY_CHECKED_IN',
  'DATE_NOT_CHECKED_IN',
] as const;
export type DatingDomainErrorCode = (typeof DATING_DOMAIN_ERRORS)[number];

export const DATING_REUSED_ERRORS = [
  'CANCEL_TOO_LATE',
  'NOT_PARTICIPANT',
  'PARTNER_NOT_FOUND',
  'NOT_FOUND',
  'INVALID_ID',
  'VALIDATION_FAILED',
] as const;
