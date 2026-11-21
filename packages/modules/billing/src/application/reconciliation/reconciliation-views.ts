import type {
  ReconciliationMismatch,
  ReconciliationReport,
  ReconciliationStatus,
  ReconciliationTotals,
} from '../../domain/reconciliation.js';

export type { ReconciliationMismatch, ReconciliationStatus, ReconciliationTotals };

/** Dữ liệu đọc của một báo cáo đối soát cho presentation / worker (không lộ entity domain). */
export interface ReconciliationReportView {
  readonly id: string;
  readonly reportDate: string;
  readonly runAt: Date;
  readonly status: ReconciliationStatus;
  readonly totals: ReconciliationTotals;
  readonly mismatches: readonly ReconciliationMismatch[];
}

export const toReconciliationReportView = (r: ReconciliationReport): ReconciliationReportView => ({
  id: r.id,
  reportDate: r.reportDate,
  runAt: r.runAt,
  status: r.status,
  totals: r.totals,
  mismatches: r.mismatches,
});
