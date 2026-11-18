import { KYC_MEDIA_RETENTION_DAYS } from '@tamgiao/contracts/constants';
import type { KycStatus } from './kyc-submission.js';

const DAY_MS = 86_400_000;

/**
 * Thời hạn lưu ảnh eKYC (BE-S3-06, D6): ảnh CCCD/selfie/giấy xác nhận độc thân của hồ sơ **đã quyết định**
 * (`APPROVED`/`REJECTED`) được xoá khi `decidedAt` cách hiện tại **hơn** `KYC_MEDIA_RETENTION_DAYS` ngày.
 * Metadata + kết quả thẩm định (trạng thái, các bước, đánh giá eKYC, số CCCD mã hoá) được giữ lại.
 */
export const kycMediaRetentionCutoff = (now: Date): Date =>
  new Date(now.getTime() - KYC_MEDIA_RETENTION_DAYS * DAY_MS);

export interface KycMediaRetentionSubject {
  readonly status: KycStatus;
  readonly decidedAt: Date | null;
}

/** Hồ sơ đã quyết định và quá hạn lưu ảnh (đúng biên `decidedAt = cutoff` thì chưa quá hạn). */
export function isKycMediaRetentionExpired(subject: KycMediaRetentionSubject, now: Date): boolean {
  const decided = subject.status === 'APPROVED' || subject.status === 'REJECTED';
  return (
    decided &&
    subject.decidedAt !== null &&
    subject.decidedAt.getTime() < kycMediaRetentionCutoff(now).getTime()
  );
}
