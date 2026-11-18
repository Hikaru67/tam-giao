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
  /** Chưa thanh toán xác thực (BE-S4-03) — mã đăng ký ở contracts `billing/errors.ts`. */
  'PAYMENT_REQUIRED',
] as const;

export type VerificationDomainErrorCode = (typeof VERIFICATION_DOMAIN_ERRORS)[number];

/** Mã lỗi phỏng vấn sơ bộ (BE-S3-05) — đăng ký ở `@tamgiao/contracts` (`verification/interview-errors.ts`). */
export const INTERVIEW_ERRORS = [
  'SLOT_TAKEN',
  'CANCEL_TOO_LATE',
  'INTERVIEW_SLOT_IN_PAST',
  'INTERVIEW_SLOT_NOT_FOUND',
  'INTERVIEW_SLOT_OVERLAP',
  'INTERVIEW_NOT_BOOKED',
  'INTERVIEW_NOT_STARTED',
  'INTERVIEW_ALREADY_BOOKED',
  'INTERVIEW_ALREADY_PASSED',
  'INTERVIEW_REQUIRES_SUBMISSION',
] as const;

export type InterviewErrorCode = (typeof INTERVIEW_ERRORS)[number];
