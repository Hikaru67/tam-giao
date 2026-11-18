import { z } from 'zod';
import { KYC_MORE_INFO_ITEMS, KYC_REJECTION_REASON_CODES } from './events.js';

const uploadKey = z.string().trim().min(1).max(300).nullish();

/**
 * `POST /me/kyc` — nộp (hoặc nộp bổ sung khi `NEEDS_MORE_INFO`) bộ tài liệu eKYC. Mỗi trường là `key` trả về từ
 * `POST /uploads`: CCCD mặt trước/sau + giấy xác nhận tình trạng hôn nhân dùng purpose `kyc_doc`, selfie dùng
 * `kyc_selfie`. Thiếu trường → `KYC_DOCS_MISSING` (`meta.missing`). Nộp bổ sung gửi lại đủ 4 key (được dùng lại
 * key cũ cho tài liệu không cần thay).
 */
export const submitKycBodySchema = z.object({
  cccdFrontKey: uploadKey,
  cccdBackKey: uploadKey,
  selfieKey: uploadKey,
  maritalStatusCertificateKey: uploadKey,
});
export type SubmitKycBody = z.infer<typeof submitKycBodySchema>;

/** Trạng thái hồ sơ cho màn 6; `NOT_SUBMITTED` khi chưa nộp. */
export const KYC_PROGRESS_STATUSES = [
  'NOT_SUBMITTED',
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_MORE_INFO',
  'APPROVED',
  'REJECTED',
] as const;

/** 4 bước theo thứ tự hiển thị. */
export const KYC_STEP_NAMES = ['CCCD_CHIP', 'MARITAL_STATUS', 'MANUAL_REVIEW', 'INTERVIEW'] as const;
export const KYC_STEP_STATUS_VALUES = ['PENDING', 'PASSED', 'FAILED'] as const;

/**
 * `GET /me/kyc` (và phản hồi `POST /me/kyc`) — tiến trình thẩm định. `steps` luôn đủ 4 bước theo thứ tự
 * `KYC_STEP_NAMES`. Không bao giờ chứa số CCCD hay điểm eKYC.
 */
export const kycProgressResponseSchema = z.object({
  status: z.enum(KYC_PROGRESS_STATUSES),
  submittedAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  steps: z.array(
    z.object({
      step: z.enum(KYC_STEP_NAMES),
      status: z.enum(KYC_STEP_STATUS_VALUES),
      decidedAt: z.iso.datetime().nullable(),
    }),
  ),
  /** Tài liệu cần bổ sung — chỉ khác `null` khi `NEEDS_MORE_INFO`. */
  moreInfo: z.object({ items: z.array(z.enum(KYC_MORE_INFO_ITEMS)), note: z.string().nullable() }).nullable(),
  /** Mã lý do — chỉ khác `null` khi `REJECTED`. */
  rejectionReason: z.enum(KYC_REJECTION_REASON_CODES).nullable(),
});
export type KycProgressResponse = z.infer<typeof kycProgressResponseSchema>;

/**
 * Huy hiệu xác thực trả trong `GET /me` (`badges`) — theo từng bước đã đạt, không có khi hồ sơ bị từ chối:
 * `CCCD_VERIFIED` (bước `CCCD_CHIP`), `SINGLE_VERIFIED` (`MARITAL_STATUS`), `INTERVIEWED` (`INTERVIEW`).
 */
export const VERIFICATION_BADGES = ['CCCD_VERIFIED', 'SINGLE_VERIFIED', 'INTERVIEWED'] as const;
export type VerificationBadge = (typeof VERIFICATION_BADGES)[number];
