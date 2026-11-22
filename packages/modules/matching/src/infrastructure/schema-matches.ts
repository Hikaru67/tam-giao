import { timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, text, unique, uuid } from 'drizzle-orm/pg-core';
import { matching } from './schema-base.js';

/**
 * Aggregate `Match` (BE-S5-04) — đủ cột để dựng lại `MatchState`.
 *
 * Hai người trong cặp lưu 2 cột `user_a` / `user_b` (giữ đúng thứ tự lúc đề xuất) thay vì mảng: cặp luôn đúng 2 người,
 * CHECK `user_a <> user_b` viết trực tiếp, index btree theo từng người cho `findOpenByUser`. Độc quyền 1-1 do
 * `active_slots` bảo đảm (A10), bảng này không cần ràng buộc riêng. `staff_note` / `decline_reason` có thể chứa PII —
 * không log, không đưa vào event. `version` = version aggregate (kiểm tra lạc quan khi lưu).
 */
export const matches = matching.table(
  'matches',
  {
    id: uuid('id').primaryKey(),
    userA: uuid('user_a').notNull(),
    userB: uuid('user_b').notNull(),
    createdBy: uuid('created_by').notNull(),
    status: text('status').notNull(),
    acceptedBy: uuid('accepted_by')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    scoreSnapshot: jsonb('score_snapshot'),
    staffNote: text('staff_note'),
    expiresAt: timestamptz('expires_at'),
    offeredAt: timestamptz('offered_at').notNull(),
    datingStartedAt: timestamptz('dating_started_at'),
    metAt: timestamptz('met_at'),
    closedAt: timestamptz('closed_at'),
    declinedBy: uuid('declined_by'),
    declineReason: text('decline_reason'),
    withdrawn: boolean('withdrawn').notNull().default(false),
    closeOutcome: text('close_outcome'),
    lockReason: text('lock_reason'),
    /** Mã lý do đóng (vd `TIMEOUT` khi hết `DATING_DAYS` chưa gặp — BE-S7-04); `null` = đóng thủ công / chưa đóng. */
    closeReason: text('close_reason'),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    check('matches_distinct_users_ck', sql`${t.userA} <> ${t.userB}`),
    check(
      'matches_status_ck',
      sql`${t.status} in ('OFFERED', 'AWAITING_RESPONSE', 'DATING', 'MET', 'CLOSED_SUCCESS', 'CLOSED_STOPPED', 'EXPIRED', 'DECLINED', 'LOCKED')`,
    ),
    check('matches_close_outcome_ck', sql`${t.closeOutcome} in ('SUCCESS', 'STOPPED')`),
    check(
      'matches_close_reason_ck',
      sql`${t.closeReason} is null or ${t.status} in ('CLOSED_SUCCESS', 'CLOSED_STOPPED')`,
    ),
    check('matches_accepted_by_ck', sql`cardinality(${t.acceptedBy}) <= 2`),
    check('matches_version_ck', sql`${t.version} >= 1`),
    index('matches_user_a_idx').on(t.userA),
    index('matches_user_b_idx').on(t.userB),
  ],
);

/**
 * Nhật ký event của match (BE-S5-04) — **chỉ ghi thêm** (AGENTS.md mục 4): trigger trong migration chặn mọi
 * UPDATE/DELETE. Mỗi domain event của match một dòng (`id` = `eventId`), ghi cùng `tx` với `matches` + outbox.
 * Payload giống outbox (không PII).
 */
export const matchEvents = matching.table(
  'match_events',
  {
    id: uuid('id').primaryKey(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [unique('match_events_match_version_uq').on(t.matchId, t.version)],
);
