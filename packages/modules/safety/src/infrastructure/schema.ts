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
    index('reports_reporter_id_idx').on(t.reporterId),
    index('reports_reported_user_id_idx').on(t.reportedUserId),
    index('reports_status_due_at_idx').on(t.status, t.dueAt),
  ],
);
