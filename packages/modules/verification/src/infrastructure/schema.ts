import { bytea, timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgSchema, text, unique, uuid } from 'drizzle-orm/pg-core';

/** Schema Postgres của module verification (AGENTS.md mục 4). */
export const verification = pgSchema('verification');

/** Tên constraint — repository dùng để map vi phạm unique (23505) sang mã lỗi nghiệp vụ. */
export const KYC_USER_UNIQUE = 'kyc_submissions_user_id_uq';
export const KYC_CCCD_BIDX_UNIQUE = 'kyc_submissions_cccd_number_bidx_uq';

/**
 * Hồ sơ thẩm định eKYC + độc thân (BE-S3-03). Một người dùng một hồ sơ (`user_id` unique); một số CCCD chỉ gắn
 * một hồ sơ (`cccd_number_bidx` unique, cho phép nhiều NULL khi eKYC chưa đọc được số).
 */
export const kycSubmissions = verification.table(
  'kyc_submissions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    status: text('status').notNull(),
    /** `{ "<STEP>": { "status": "PENDING|PASSED|FAILED", "decidedAt": iso | null } }` cho đủ 4 bước. */
    steps: jsonb('steps').notNull(),
    /** Số CCCD, mã hoá qua `Encryptor` (context `verification.kyc_submissions.cccd_number:<userId>`). */
    cccdNumberEnc: bytea('cccd_number_enc'),
    /** Blind index HMAC của số CCCD (purpose `verification.cccd_number`). */
    cccdNumberBidx: text('cccd_number_bidx'),
    /** Key object bucket `private-kyc`; NULL sau khi job xoá ảnh theo thời hạn lưu trữ (BE-S3-06). */
    cccdFrontKey: text('cccd_front_key'),
    cccdBackKey: text('cccd_back_key'),
    selfieKey: text('selfie_key'),
    maritalStatusCertificateKey: text('marital_status_certificate_key'),
    /** Đánh giá eKYC (gợi ý cho chuyên viên): kết quả từng thao tác + điểm + cờ lệch với hồ sơ. Không chứa PII. */
    ekycAssessment: jsonb('ekyc_assessment'),
    reviewerId: uuid('reviewer_id'),
    /** `{ items: string[], note: string | null, requestedAt: iso }` khi `NEEDS_MORE_INFO`. */
    moreInfoRequest: jsonb('more_info_request'),
    rejectionCode: text('rejection_code'),
    rejectionNote: text('rejection_note'),
    decidedBy: uuid('decided_by'),
    createdAt: timestamptz('created_at').notNull(),
    submittedAt: timestamptz('submitted_at'),
    decidedAt: timestamptz('decided_at'),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    unique(KYC_USER_UNIQUE).on(t.userId),
    unique(KYC_CCCD_BIDX_UNIQUE).on(t.cccdNumberBidx),
    check(
      'kyc_submissions_status_ck',
      sql`${t.status} in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO', 'APPROVED', 'REJECTED')`,
    ),
    check('kyc_submissions_cccd_pair_ck', sql`(${t.cccdNumberEnc} is null) = (${t.cccdNumberBidx} is null)`),
    check('kyc_submissions_rejection_ck', sql`(${t.status} = 'REJECTED') = (${t.rejectionCode} is not null)`),
    index('kyc_submissions_status_submitted_idx').on(t.status, t.submittedAt),
  ],
);
