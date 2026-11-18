/**
 * Event payload của module verification (phát qua outbox). Không chứa PII (không số CCCD, không ghi chú
 * của chuyên viên) — consumer tự tra theo id qua facade verification.
 */

/** Người dùng nộp hồ sơ (`resubmission = false`) hoặc nộp bổ sung sau khi được yêu cầu (`true`). */
export const KYC_SUBMITTED = 'KycSubmitted';
export interface KycSubmittedPayload {
  readonly submissionId: string;
  readonly userId: string;
  readonly resubmission: boolean;
}

/** Hồ sơ được duyệt (cả 4 bước đạt) — matching coi user đủ điều kiện, notification báo người dùng. */
export const KYC_APPROVED = 'KycApproved';
export interface KycApprovedPayload {
  readonly submissionId: string;
  readonly userId: string;
}

export const KYC_REJECTION_REASON_CODES = [
  'INVALID_ID_DOCUMENT',
  'FACE_MISMATCH',
  'INFO_MISMATCH',
  'MARITAL_STATUS_UNVERIFIED',
  'NOT_ELIGIBLE',
  'DUPLICATE_ACCOUNT',
  'INTERVIEW_FAILED',
  'OTHER',
] as const;
export type KycRejectionReasonCode = (typeof KYC_REJECTION_REASON_CODES)[number];

/** Hồ sơ bị từ chối — billing hoàn tiền (`REFUND_SLA_HOURS`), notification báo người dùng. */
export const KYC_REJECTED = 'KycRejected';
export interface KycRejectedPayload {
  readonly submissionId: string;
  readonly userId: string;
  readonly reasonCode: KycRejectionReasonCode;
}

export const KYC_MORE_INFO_ITEMS = [
  'CCCD_FRONT',
  'CCCD_BACK',
  'SELFIE',
  'MARITAL_STATUS_CERTIFICATE',
  'OTHER',
] as const;
export type KycMoreInfoItem = (typeof KYC_MORE_INFO_ITEMS)[number];

/** Chuyên viên yêu cầu bổ sung tài liệu — notification báo người dùng danh sách cần nộp lại. */
export const KYC_MORE_INFO_REQUESTED = 'KycMoreInfoRequested';
export interface KycMoreInfoRequestedPayload {
  readonly submissionId: string;
  readonly userId: string;
  readonly items: readonly KycMoreInfoItem[];
}
