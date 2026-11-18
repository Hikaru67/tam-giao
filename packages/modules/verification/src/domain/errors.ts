/**
 * Mã lỗi nghiệp vụ tầng domain của module verification (AGENTS.md A4). Mỗi mã phải được đăng ký HTTP status
 * ở `@tamgiao/contracts` (`verification/errors.ts` hoặc mã chung) — test `kyc-errors.test.ts` kiểm tra điều này.
 */
export const VERIFICATION_DOMAIN_ERRORS = [
  'INVALID_CCCD_NUMBER',
  'REJECTION_REASON_REQUIRED',
  'KYC_MORE_INFO_ITEMS_REQUIRED',
  'KYC_INVALID_TRANSITION',
  'KYC_STEPS_INCOMPLETE',
  'KYC_ALREADY_DECIDED',
  'KYC_ALREADY_SUBMITTED',
  'KYC_DOCS_MISSING',
  'CCCD_ALREADY_REGISTERED',
  'KYC_SUBMISSION_NOT_FOUND',
  'KYC_CCCD_NUMBER_MISSING',
] as const;

export type VerificationDomainErrorCode = (typeof VERIFICATION_DOMAIN_ERRORS)[number];
