/**
 * Mã lỗi nghiệp vụ của module safety (AGENTS.md A4). Mỗi mã phải được đăng ký HTTP status ở `@tamgiao/contracts`
 * (`safety/errors.ts`) — test `safety-errors.test.ts` kiểm tra điều này.
 */
export const SAFETY_DOMAIN_ERRORS = [
  'REPORT_TARGET_INVALID',
  'REPORT_DESCRIPTION_TOO_LONG',
  'REPORT_EVIDENCE_TOO_MANY',
  'REPORT_INVALID_TRANSITION',
  'REPORT_NOT_FOUND',
  'REPORT_CONCLUSION_INVALID',
  'BAN_REASON_INVALID',
  'USER_ALREADY_BANNED',
  'FLAGGED_MESSAGE_NOT_FOUND',
] as const;

export type SafetyDomainErrorCode = (typeof SAFETY_DOMAIN_ERRORS)[number];
