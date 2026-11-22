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
