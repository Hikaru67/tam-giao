import { timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';

/** Schema Postgres của module safety (AGENTS.md mục 4). */
export const safety = pgSchema('safety');

/**
 * Aggregate `Report` (BE-S6-05) — báo cáo vi phạm. `description` là văn bản tự do (có thể chứa PII): không log, không
 * đưa vào event/audit. `evidence_keys` = key upload `report_evidence` (bucket private) đã xác nhận thuộc người báo
 * cáo. `match_id` tham chiếu `matching.matches` nhưng không khai FK (A3: không phụ thuộc bảng module khác).
 * `due_at` có ⇔ `urgent` ("Chuyên viên can thiệp khẩn cấp"). Index `(status, due_at)` cho hàng chờ admin (BE-S6-06).
 */
export const reports = safety.table(
  'reports',
  {
    id: uuid('id').primaryKey(),
    reporterId: uuid('reporter_id').notNull(),
    reportedUserId: uuid('reported_user_id').notNull(),
    matchId: uuid('match_id').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    description: text('description'),
    evidenceKeys: text('evidence_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    urgent: boolean('urgent').notNull(),
    dueAt: timestamptz('due_at'),
    status: text('status').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    closedAt: timestamptz('closed_at'),
    /** BE-S6-06: admin nhận xử lý / đóng báo cáo gần nhất (id `identity.admin_users`, không FK — A3). */
    handledBy: uuid('handled_by'),
    /** BE-S6-06: kết luận của chuyên viên khi đóng (văn bản tự do, PII — không log/event/audit). */
    conclusion: text('conclusion'),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    check('reports_distinct_users_ck', sql`${t.reporterId} <> ${t.reportedUserId}`),
    check(
      'reports_category_ck',
      sql`${t.category} in ('MARITAL_FRAUD', 'FINANCIAL_SCAM', 'HARASSMENT', 'NO_SHOW_DISRESPECT')`,
    ),
    check('reports_severity_ck', sql`${t.severity} in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')`),
    check('reports_status_ck', sql`${t.status} in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')`),
    check('reports_description_length_ck', sql`char_length(${t.description}) <= 1000`),
    check('reports_evidence_count_ck', sql`cardinality(${t.evidenceKeys}) <= 5`),
    check('reports_urgent_due_at_ck', sql`${t.urgent} = (${t.dueAt} is not null)`),
    check('reports_version_ck', sql`${t.version} >= 1`),
    check('reports_conclusion_length_ck', sql`char_length(${t.conclusion}) <= 2000`),
    check(
      'reports_closed_at_ck',
      sql`(${t.status} in ('RESOLVED', 'DISMISSED')) = (${t.closedAt} is not null)`,
    ),
    index('reports_reporter_id_idx').on(t.reporterId),
    index('reports_reported_user_id_idx').on(t.reportedUserId),
    index('reports_status_due_at_idx').on(t.status, t.dueAt),
  ],
);

/**
 * Aggregate `UserBan` (BE-S6-06) — quyết định khoá vĩnh viễn. PK `user_id`: mỗi người dùng tối đa một bản ghi, chặn
 * hai admin khoá đồng thời ở DB (A10). `reason` là văn bản tự do (có thể chứa PII): không log, không đưa vào
 * event/audit. `user_id`, `report_id`, `banned_by` không khai FK sang module khác (A3).
 */
export const userBans = safety.table(
  'user_bans',
  {
    userId: uuid('user_id').primaryKey(),
    id: uuid('id').notNull().unique('user_bans_id_uq'),
    reason: text('reason').notNull(),
    reportId: uuid('report_id').references(() => reports.id),
    bannedBy: uuid('banned_by').notNull(),
    bannedAt: timestamptz('banned_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    check('user_bans_reason_length_ck', sql`char_length(${t.reason}) between 1 and 1000`),
    check('user_bans_version_ck', sql`${t.version} >= 1`),
  ],
);
