import { z } from 'zod';
import { KYC_STEP_NAMES, KYC_STEP_STATUS_VALUES } from '../dto.js';
import { KYC_MORE_INFO_ITEMS, KYC_REJECTION_REASON_CODES } from '../events.js';

/**
 * DTO màn "Web Admin – Thẩm định eKYC" (BE-S3-04). Route prefix `/admin/kyc`; xem cần `kyc:review`,
 * quyết định cần `kyc:decide`.
 */

/** Trạng thái hồ sơ admin lọc được (hồ sơ `DRAFT` chưa nộp không vào hàng chờ). */
export const KYC_ADMIN_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_MORE_INFO',
  'APPROVED',
  'REJECTED',
] as const;
export type KycAdminStatus = (typeof KYC_ADMIN_STATUSES)[number];

/** Mặc định của hàng chờ: hồ sơ đang chờ chuyên viên xử lý. */
export const KYC_QUEUE_DEFAULT_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'] as const;

/** Trạng thái đầy đủ của hồ sơ (chi tiết có thể là `DRAFT`). */
const KYC_SUBMISSION_STATUSES = ['DRAFT', ...KYC_ADMIN_STATUSES] as const;

/** Cờ cảnh báo eKYC (gợi ý cho chuyên viên). Hồ sơ "có cờ" ⇔ danh sách khác rỗng. */
export const KYC_EKYC_FLAGS = [
  'EKYC_MISSING',
  'OCR_REJECTED',
  'OCR_ERROR',
  'LIVENESS_REJECTED',
  'LIVENESS_ERROR',
  'FACE_MATCH_REJECTED',
  'FACE_MATCH_ERROR',
  'FULL_NAME_MISMATCH',
  'BIRTH_DATE_MISMATCH',
  'PROFILE_NOT_COMPARED',
] as const;
export type KycEkycFlag = (typeof KYC_EKYC_FLAGS)[number];

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

/**
 * `GET /admin/kyc/submissions` — hàng chờ, hồ sơ chờ lâu nhất trước (`submittedAt` tăng dần).
 * - `status`: danh sách phân tách bằng dấu phẩy; bỏ trống = `SUBMITTED,UNDER_REVIEW`.
 * - `flagged`: `true` = chỉ hồ sơ có cờ eKYC, `false` = chỉ hồ sơ không cờ.
 * - `q`: tìm theo họ tên hoặc nghề nghiệp (không phân biệt hoa/thường, cần gõ đúng dấu).
 */
export const kycQueueQuerySchema = z.object({
  status: z
    .string()
    .transform((raw) =>
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .pipe(z.array(z.enum(KYC_ADMIN_STATUSES)).min(1))
    .optional(),
  flagged: booleanQuery.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  /** `nextCursor` của trang trước. */
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type KycQueueQuery = z.infer<typeof kycQueueQuerySchema>;

const stepSchema = z.object({
  step: z.enum(KYC_STEP_NAMES),
  status: z.enum(KYC_STEP_STATUS_VALUES),
  decidedAt: z.iso.datetime().nullable(),
});

export const kycQueueItemSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  status: z.enum(KYC_ADMIN_STATUSES),
  /** Từ hồ sơ (module profile); `null` khi chưa khai. */
  fullName: z.string().nullable(),
  occupation: z.string().nullable(),
  submittedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  reviewerId: z.uuid().nullable(),
  flags: z.array(z.enum(KYC_EKYC_FLAGS)),
  steps: z.array(stepSchema),
});
export type KycQueueItem = z.infer<typeof kycQueueItemSchema>;

export const kycQueueResponseSchema = z.object({
  items: z.array(kycQueueItemSchema),
  /** `null` khi hết dữ liệu. */
  nextCursor: z.string().nullable(),
});
export type KycQueueResponse = z.infer<typeof kycQueueResponseSchema>;

const ekycCheckSchema = z.object({
  status: z.enum(['OK', 'REJECTED', 'ERROR']),
  /** Điểm thang [0, 1] (nếu thao tác trả điểm). */
  score: z.number().nullable(),
  /** Mã phân loại khi `REJECTED`/`ERROR` (vd `IMAGE_BLURRY`, `TIMEOUT`). */
  reason: z.string().nullable(),
});

/** Presigned GET ảnh bucket private, hết hạn sau `PRESIGNED_URL_TTL_SECONDS`. `null` khi ảnh đã bị xoá. */
const documentUrlSchema = z.object({ url: z.url(), expiresAt: z.iso.datetime() }).nullable();

/**
 * `GET /admin/kyc/submissions/:id` — chi tiết hồ sơ. **Chứa PII** (số CCCD đầy đủ để đối chiếu, họ tên, ngày sinh,
 * link ảnh) — mỗi lần gọi ghi 1 bản ghi audit `kyc.view_detail`.
 */
export const kycAdminDetailResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  status: z.enum(KYC_SUBMISSION_STATUSES),
  version: z.number().int(),
  applicant: z.object({
    fullName: z.string().nullable(),
    /** `YYYY-MM-DD`. */
    birthDate: z.string().nullable(),
    occupation: z.string().nullable(),
  }),
  /** 12 chữ số; `null` khi eKYC chưa đọc được số. */
  cccdNumber: z.string().nullable(),
  documents: z.object({
    cccdFront: documentUrlSchema,
    cccdBack: documentUrlSchema,
    selfie: documentUrlSchema,
    maritalStatusCertificate: documentUrlSchema,
  }),
  ekycAssessment: z
    .object({
      ocr: ekycCheckSchema,
      liveness: ekycCheckSchema,
      faceMatch: ekycCheckSchema,
      /** Trường OCR lệch hồ sơ; `null` khi không đối chiếu được. */
      profileMismatches: z.array(z.enum(['FULL_NAME', 'BIRTH_DATE'])).nullable(),
      assessedAt: z.iso.datetime(),
    })
    .nullable(),
  flags: z.array(z.enum(KYC_EKYC_FLAGS)),
  steps: z.array(stepSchema),
  reviewerId: z.uuid().nullable(),
  /** Yêu cầu bổ sung đang mở (khi `NEEDS_MORE_INFO`). */
  moreInfoRequest: z
    .object({
      items: z.array(z.enum(KYC_MORE_INFO_ITEMS)),
      note: z.string().nullable(),
      requestedAt: z.iso.datetime(),
    })
    .nullable(),
  rejection: z.object({ code: z.enum(KYC_REJECTION_REASON_CODES), note: z.string().nullable() }).nullable(),
  decidedBy: z.uuid().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type KycAdminDetailResponse = z.infer<typeof kycAdminDetailResponseSchema>;

/** `POST /admin/kyc/submissions/:id/steps` — đánh dấu một bước đạt/không đạt. */
export const kycMarkStepBodySchema = z.object({
  step: z.enum(KYC_STEP_NAMES),
  outcome: z.enum(['PASSED', 'FAILED']),
});
export type KycMarkStepBody = z.infer<typeof kycMarkStepBodySchema>;

/** `POST /admin/kyc/submissions/:id/reject` — `note` bắt buộc khi `code = OTHER`. */
export const kycRejectBodySchema = z.object({
  code: z.string().min(1).max(50),
  note: z.string().max(2000).nullish(),
});
export type KycRejectBody = z.infer<typeof kycRejectBodySchema>;

/** `POST /admin/kyc/submissions/:id/request-more-info`. */
export const kycRequestMoreInfoBodySchema = z.object({
  items: z.array(z.enum(KYC_MORE_INFO_ITEMS)).max(KYC_MORE_INFO_ITEMS.length),
  note: z.string().max(1000).nullish(),
});
export type KycRequestMoreInfoBody = z.infer<typeof kycRequestMoreInfoBodySchema>;

/** Phản hồi chung của các thao tác quyết định (`assign`, `steps`, `approve`, `reject`, `request-more-info`). */
export const kycAdminDecisionResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(KYC_SUBMISSION_STATUSES),
  version: z.number().int(),
  steps: z.array(stepSchema),
  reviewerId: z.uuid().nullable(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type KycAdminDecisionResponse = z.infer<typeof kycAdminDecisionResponseSchema>;
