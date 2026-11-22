import { timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Schema Postgres của module dating (AGENTS.md mục 4). drizzle-kit đọc file này. */
export const dating = pgSchema('dating');

/** Tên constraint — repository map vi phạm unique (23505) sang `DATE_ALREADY_OPEN`. */
export const DATE_PLANS_OPEN_PER_MATCH_UNIQUE = 'date_plans_open_per_match_uq';

/**
 * Aggregate `DatePlan` (BE-S7-01). `match_id`, `inviter_id`, `invitee_id`, `partner_id` chỉ là tham chiếu sang module
 * khác — không khai FK (A3). Partial unique index trên `match_id` khi `PROPOSED | CONFIRMED | CHECKED_IN`: mỗi match tối
 * đa một lịch đang mở, chốt chặn ở DB cho hai lượt đề xuất đồng thời (A10).
 */
export const datePlans = dating.table(
  'date_plans',
  {
    id: uuid('id').primaryKey(),
    matchId: uuid('match_id').notNull(),
    inviterId: uuid('inviter_id').notNull(),
    inviteeId: uuid('invitee_id').notNull(),
    partnerId: uuid('partner_id').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    staffBookingRequested: boolean('staff_booking_requested').notNull().default(false),
    status: text('status').notNull(),
    proposedAt: timestamptz('proposed_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    respondedAt: timestamptz('responded_at'),
    cancelledAt: timestamptz('cancelled_at'),
    cancelledBy: uuid('cancelled_by'),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    uniqueIndex(DATE_PLANS_OPEN_PER_MATCH_UNIQUE)
      .on(t.matchId)
      .where(sql`${t.status} in ('PROPOSED', 'CONFIRMED', 'CHECKED_IN')`),
    check('date_plans_distinct_users_ck', sql`${t.inviterId} <> ${t.inviteeId}`),
    check(
      'date_plans_status_ck',
      sql`${t.status} in ('PROPOSED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED')`,
    ),
    check('date_plans_time_range_ck', sql`${t.endsAt} > ${t.startsAt}`),
    check('date_plans_expiry_ck', sql`${t.expiresAt} > ${t.proposedAt} and ${t.expiresAt} <= ${t.startsAt}`),
    check(
      'date_plans_cancelled_state_ck',
      sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} is not null and ${t.cancelledBy} is not null)`,
    ),
    check('date_plans_version_ck', sql`${t.version} >= 1`),
    index('date_plans_match_idx').on(t.matchId, t.proposedAt),
  ],
);

/** Tên constraint — repository map vi phạm unique (23505) sang `FEEDBACK_ALREADY_SUBMITTED`. */
export const FEEDBACKS_MATCH_AUTHOR_UNIQUE = 'feedbacks_match_author_uq';

/**
 * Bảng đánh giá kín BE-S7-03, chỉ chuyên viên đọc, stop_note là PII không log.
 * `match_id`, `date_plan_id`, `author_id`, `subject_id` chỉ là tham chiếu sang module khác hoặc bảng khác — không khai FK (A3).
 * Mỗi người tối đa một đánh giá / match (unique index `feedbacks_match_author_uq`, A10).
 */
export const feedbacks = dating.table(
  'feedbacks',
  {
    id: uuid('id').primaryKey(),
    matchId: uuid('match_id').notNull(),
    datePlanId: uuid('date_plan_id').notNull(),
    authorId: uuid('author_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    rating: integer('rating').notNull(),
    profileMatch: text('profile_match').notNull(),
    feeling: text('feeling').notNull(),
    decision: text('decision').notNull(),
    stopReasons: text('stop_reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    stopNote: text('stop_note'),
    submittedAt: timestamptz('submitted_at').notNull(),
  },
  (t) => [
    uniqueIndex(FEEDBACKS_MATCH_AUTHOR_UNIQUE).on(t.matchId, t.authorId),
    check('feedbacks_distinct_users_ck', sql`${t.authorId} <> ${t.subjectId}`),
    check('feedbacks_rating_ck', sql`${t.rating} between 1 and 5`),
    check('feedbacks_profile_match_ck', sql`${t.profileMatch} in ('FULL_MATCH', 'MOSTLY_MATCH', 'DIFFERENT')`),
    check('feedbacks_feeling_ck', sql`${t.feeling} in ('DEEP_INTEREST', 'NEED_MORE_TIME', 'NOT_A_FIT')`),
    check('feedbacks_decision_ck', sql`${t.decision} in ('A_COMMIT', 'B_STOP')`),
    check(
      'feedbacks_stop_details_ck',
      sql`(${t.decision} = 'B_STOP') or (cardinality(${t.stopReasons}) = 0 and ${t.stopNote} is null)`,
    ),
    index('feedbacks_appearance_flag_idx')
      .on(t.submittedAt, t.id)
      .where(sql`${t.profileMatch} = 'DIFFERENT'`),
  ],
);

