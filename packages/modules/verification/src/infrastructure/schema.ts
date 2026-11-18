import { bytea, timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgSchema, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

export const INTERVIEW_ACTIVE_BOOKING_UNIQUE = 'interview_slots_active_booking_uq';
export const INTERVIEW_INTERVIEWER_START_UNIQUE = 'interview_slots_interviewer_starts_at_uq';

/**
 * Slot phỏng vấn sơ bộ (BE-S3-05). Một slot một người đặt (khoá dòng khi đặt); mỗi người tối đa một lịch
 * `BOOKED` (partial unique index trên `booked_by`). Slot `COMPLETED` giữ `booked_by` làm nhật ký.
 */
export const interviewSlots = verification.table(
  'interview_slots',
  {
    id: uuid('id').primaryKey(),
    interviewerId: uuid('interviewer_id').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    meetingUrl: text('meeting_url'),
    status: text('status').notNull(),
    bookedBy: uuid('booked_by'),
    bookedAt: timestamptz('booked_at'),
    outcome: text('outcome'),
    /** Nhận xét phỏng vấn — có thể chứa thông tin cá nhân, chỉ trả ở API admin. */
    notes: text('notes'),
    recordedBy: uuid('recorded_by'),
    recordedAt: timestamptz('recorded_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    unique(INTERVIEW_INTERVIEWER_START_UNIQUE).on(t.interviewerId, t.startsAt),
    uniqueIndex(INTERVIEW_ACTIVE_BOOKING_UNIQUE)
      .on(t.bookedBy)
      .where(sql`${t.status} = 'BOOKED'`),
    check('interview_slots_status_ck', sql`${t.status} in ('OPEN', 'BOOKED', 'COMPLETED')`),
    check('interview_slots_outcome_ck', sql`${t.outcome} is null or ${t.outcome} in ('PASSED', 'FAILED')`),
    check('interview_slots_booked_ck', sql`(${t.status} = 'OPEN') = (${t.bookedBy} is null)`),
    check('interview_slots_completed_ck', sql`(${t.status} = 'COMPLETED') = (${t.outcome} is not null)`),
    check('interview_slots_time_ck', sql`${t.endsAt} > ${t.startsAt}`),
    index('interview_slots_status_starts_at_idx').on(t.status, t.startsAt),
  ],
);
