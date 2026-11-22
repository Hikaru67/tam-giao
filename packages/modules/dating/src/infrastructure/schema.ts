import { bytea, timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Schema Postgres của module dating (AGENTS.md mục 4). drizzle-kit đọc file này. */
export const dating = pgSchema('dating');

/** Tên constraint — repository map vi phạm unique (23505) sang `DATE_ALREADY_OPEN`. */
export const DATE_PLANS_OPEN_PER_MATCH_UNIQUE = 'date_plans_open_per_match_uq';

/** Tên constraint — repository map vi phạm unique (23505) sang `DATE_ALREADY_CHECKED_IN` (BE-S7-02). */
export const SAFETY_CHECK_INS_PLAN_USER_UNIQUE = 'safety_check_ins_plan_user_uq';

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

/**
 * Aggregate `SafetyCheckIn` (BE-S7-02). Mỗi (date_plan_id, user_id) tối đa một bản ghi check-in.
 * `match_id`, `user_id`, `partner_id` là tham chiếu sang module khác — không khai FK (A3).
 * `date_plan_id` tham chiếu cùng schema dating nên có FK.
 */
export const safetyCheckIns = dating.table(
  'safety_check_ins',
  {
    id: uuid('id').primaryKey(),
    datePlanId: uuid('date_plan_id')
      .notNull()
      .references(() => datePlans.id),
    matchId: uuid('match_id').notNull(),
    userId: uuid('user_id').notNull(),
    partnerId: uuid('partner_id').notNull(),
    source: text('source').notNull(),
    checkedInAt: timestamptz('checked_in_at').notNull(),
    dateEndsAt: timestamptz('date_ends_at').notNull(),
    overdueAt: timestamptz('overdue_at').notNull(),
    checkedOutAt: timestamptz('checked_out_at'),
    overdueAlertedAt: timestamptz('overdue_alerted_at'),
    locationShared: boolean('location_shared').notNull().default(false),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    uniqueIndex(SAFETY_CHECK_INS_PLAN_USER_UNIQUE).on(t.datePlanId, t.userId),
    check('safety_check_ins_source_ck', sql`${t.source} in ('MANUAL', 'VOUCHER')`),
    check('safety_check_ins_overdue_ck', sql`${t.overdueAt} > ${t.dateEndsAt}`),
    check(
      'safety_check_ins_checkout_ck',
      sql`${t.checkedOutAt} is null or ${t.checkedOutAt} >= ${t.checkedInAt}`,
    ),
    check('safety_check_ins_version_ck', sql`${t.version} >= 1`),
    index('safety_check_ins_user_idx').on(t.userId),
  ],
);

/**
 * Vị trí thô gửi kèm check-in an toàn (BE-S7-02).
 * Vị trí là dữ liệu cá nhân, mã hoá qua `Encryptor` (context `dating.check_in_locations:<checkInId>`),
 * tự xoá sau CHECK_IN_LOCATION_RETENTION_HOURS. Không log vị trí.
 */
export const checkInLocations = dating.table(
  'check_in_locations',
  {
    checkInId: uuid('check_in_id')
      .primaryKey()
      .references(() => safetyCheckIns.id, { onDelete: 'cascade' }),
    locationEnc: bytea('location_enc').notNull(),
    recordedAt: timestamptz('recorded_at').notNull(),
    purgeAfter: timestamptz('purge_after').notNull(),
  },
  (t) => [
    check('check_in_locations_purge_after_ck', sql`${t.purgeAfter} > ${t.recordedAt}`),
    index('check_in_locations_purge_after_idx').on(t.purgeAfter),
  ],
);
