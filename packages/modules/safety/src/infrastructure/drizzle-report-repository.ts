import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, eq } from 'drizzle-orm';
import type { ReportRepository } from '../application/ports/report-repository.js';
import {
  REPORT_CATEGORIES,
  REPORT_SEVERITIES,
  REPORT_STATUSES,
  Report,
  type ReportCategory,
  type ReportId,
  type ReportSeverity,
  type ReportStatus,
} from '../domain/report.js';
import { reports } from './schema.js';

type ReportRow = typeof reports.$inferSelect;

const isIn =
  <T extends string>(values: readonly T[]) =>
  (v: string): v is T =>
    (values as readonly string[]).includes(v);
const isCategory = isIn<ReportCategory>(REPORT_CATEGORIES);
const isSeverity = isIn<ReportSeverity>(REPORT_SEVERITIES);
const isStatus = isIn<ReportStatus>(REPORT_STATUSES);

/** Dòng DB → aggregate. Dữ liệu sai dạng là lỗi dữ liệu/lập trình → throw (không đưa nội dung vào thông báo lỗi). */
function toReport(row: ReportRow): Report {
  if (!isCategory(row.category) || !isSeverity(row.severity) || !isStatus(row.status)) {
    throw new Error(`safety.reports ${row.id}: category/severity/status không hợp lệ`);
  }
  return Report.restore({
    id: row.id as ReportId,
    reporterId: row.reporterId,
    reportedUserId: row.reportedUserId,
    matchId: row.matchId,
    category: row.category,
    severity: row.severity,
    description: row.description,
    evidenceKeys: row.evidenceKeys,
    urgent: row.urgent,
    dueAt: row.dueAt,
    status: row.status,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

/**
 * Hiện thực `ReportRepository` trên `safety.reports` + outbox, trong `tx` của caller. Kiểm tra version lạc quan như
 * `DrizzleMatchRepository`: version trước = version hiện tại − số event chờ; `0` → INSERT, ngược lại
 * `UPDATE … WHERE version = <trước>` — không khớp dòng nào → throw.
 */
export class DrizzleReportRepository implements ReportRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async save(tx: Tx, report: Report): Promise<void> {
    const events = report.pullEvents();
    if (events.length === 0) return;
    const s = report.toState();
    const previousVersion = s.version - events.length;
    const db = asDbTx(tx);

    if (previousVersion === 0) {
      await db.insert(reports).values({
        id: s.id,
        reporterId: s.reporterId,
        reportedUserId: s.reportedUserId,
        matchId: s.matchId,
        category: s.category,
        severity: s.severity,
        description: s.description,
        evidenceKeys: [...s.evidenceKeys],
        urgent: s.urgent,
        dueAt: s.dueAt,
        status: s.status,
        createdAt: s.createdAt,
        closedAt: s.closedAt,
        updatedAt: s.updatedAt,
        version: s.version,
      });
    } else {
      const updated = await db
        .update(reports)
        .set({
          severity: s.severity,
          status: s.status,
          closedAt: s.closedAt,
          updatedAt: s.updatedAt,
          version: s.version,
        })
        .where(and(eq(reports.id, s.id), eq(reports.version, previousVersion)))
        .returning({ id: reports.id });
      if (updated.length !== 1) {
        throw new Error(`safety.reports ${s.id}: xung đột version (mong đợi ${previousVersion})`);
      }
    }
    await this.outbox.append(tx, events);
  }

  async findById(tx: Tx, id: ReportId): Promise<Report | null> {
    const [row] = await asDbTx(tx).select().from(reports).where(eq(reports.id, id));
    return row ? toReport(row) : null;
  }
}
