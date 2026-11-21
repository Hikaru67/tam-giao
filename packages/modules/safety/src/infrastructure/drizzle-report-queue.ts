import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { asc, count, desc, inArray, sql } from 'drizzle-orm';
import type {
  ReportQueue,
  ReportQueueFilter,
  ReportQueuePageRows,
  ReportQueueRow,
} from '../application/ports/report-queue.js';
import {
  REPORT_CATEGORIES,
  REPORT_SEVERITIES,
  REPORT_STATUSES,
  type ReportCategory,
  type ReportSeverity,
  type ReportStatus,
} from '../domain/report.js';
import { reports } from './schema.js';

const isIn =
  <T extends string>(values: readonly T[]) =>
  (v: string): v is T =>
    (values as readonly string[]).includes(v);
const isCategory = isIn<ReportCategory>(REPORT_CATEGORIES);
const isSeverity = isIn<ReportSeverity>(REPORT_SEVERITIES);
const isStatus = isIn<ReportStatus>(REPORT_STATUSES);

/** Thứ hạng mức độ (CRITICAL cao nhất) — `REPORT_SEVERITIES` xếp tăng dần nên rank = vị trí trong mảng. */
const severityRank = sql`array_position(array['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']::text[], ${reports.severity})`;

/**
 * Hàng chờ báo cáo admin (BE-S6-06) trên `safety.reports`: `severity` giảm dần → `due_at` tăng dần (null cuối) →
 * `created_at`, `id` tăng dần; phân trang offset (hàng chờ ngắn, chuyên viên duyệt từ đầu). Không đọc mô tả/bằng chứng.
 */
export class DrizzleReportQueue implements ReportQueue {
  async list(tx: Tx, filter: ReportQueueFilter): Promise<ReportQueuePageRows> {
    const db = asDbTx(tx);
    const where = inArray(reports.status, [...filter.statuses]);
    const rows = await db
      .select({
        reportId: reports.id,
        reporterId: reports.reporterId,
        reportedUserId: reports.reportedUserId,
        matchId: reports.matchId,
        category: reports.category,
        severity: reports.severity,
        status: reports.status,
        urgent: reports.urgent,
        dueAt: reports.dueAt,
        handledBy: reports.handledBy,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(where)
      .orderBy(
        desc(severityRank),
        sql`${reports.dueAt} asc nulls last`,
        asc(reports.createdAt),
        asc(reports.id),
      )
      .limit(filter.limit)
      .offset(filter.offset);
    const [total] = await db.select({ n: count() }).from(reports).where(where);

    return {
      total: total?.n ?? 0,
      rows: rows.map((r): ReportQueueRow => {
        if (!isCategory(r.category) || !isSeverity(r.severity) || !isStatus(r.status)) {
          throw new Error(`safety.reports ${r.reportId}: category/severity/status không hợp lệ`);
        }
        return { ...r, category: r.category, severity: r.severity, status: r.status };
      }),
    };
  }
}
