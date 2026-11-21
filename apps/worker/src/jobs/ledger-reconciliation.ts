import { ensureQueue, type JobLogger, type RetryPolicy } from '@tamgiao/db';
import type { Result } from '@tamgiao/kernel';
import type { ReconcileLedgerOutcome, ReconciliationReportView } from '@tamgiao/module-billing';
import type { PgBoss } from 'pg-boss';

/** Hàng đợi job đối soát ledger hằng ngày (BE-S4-07). */
export const LEDGER_RECONCILIATION_QUEUE = 'billing.ledger-reconciliation';

/** Lỗi DB → pg-boss chạy lại; an toàn vì mỗi ngày (giờ VN) chỉ một báo cáo (`report_date` unique). */
const RETRY: RetryPolicy = { retryLimit: 3, retryDelay: 300, retryBackoff: true };

export interface LedgerReconciler {
  execute(): Promise<Result<ReconcileLedgerOutcome, never>>;
}

/** Chỉ số liệu tổng (không PII): bigint → chuỗi để log JSON được. */
function summary(report: ReconciliationReportView) {
  const t = report.totals;
  return {
    job: LEDGER_RECONCILIATION_QUEUE,
    reportId: report.id,
    reportDate: report.reportDate,
    status: report.status,
    ledgerChargeTotal: t.ledgerChargeTotal.amount.toString(),
    ledgerRefundTotal: t.ledgerRefundTotal.amount.toString(),
    heldPaymentTotal: t.heldPaymentTotal.amount.toString(),
    heldPaymentCount: t.heldPaymentCount,
    voucherIssueEntries: t.voucherIssueEntries,
    vouchersByStatus: { ...t.vouchersByStatus },
  };
}

/**
 * Một lượt chạy: lập báo cáo đối soát. Lệch → log mức **error** (`alert: 'ledger_reconciliation_mismatch'`, chỉ số
 * liệu tổng) để gắn cảnh báo; khớp → info; ngày đã có báo cáo → info bỏ qua. Lỗi hạ tầng throw lên để pg-boss thử lại.
 */
export async function runLedgerReconciliation(
  reconciler: LedgerReconciler,
  logger: JobLogger,
): Promise<void> {
  const result = await reconciler.execute();
  if (result.isErr()) return; // `never` — không có lỗi nghiệp vụ
  const outcome = result.value;
  const { report } = outcome;
  if (outcome.kind === 'ALREADY_REPORTED') {
    logger.info(
      { job: LEDGER_RECONCILIATION_QUEUE, reportDate: report.reportDate, status: report.status },
      'ledger reconciliation already reported for date, skipped',
    );
    return;
  }
  if (report.status === 'MISMATCH') {
    logger.error(
      {
        ...summary(report),
        alert: 'ledger_reconciliation_mismatch',
        mismatches: report.mismatches.map((m) => ({
          check: m.check,
          ledger: m.ledger.toString(),
          state: m.state.toString(),
          difference: m.difference.toString(),
        })),
      },
      'ledger reconciliation mismatch',
    );
    return;
  }
  logger.info(summary(report), 'ledger reconciliation matched');
}

/** Đăng ký job định kỳ: hàng đợi (+ dead-letter), lịch cron (pg-boss `schedule`) và worker xử lý từng job một. */
export async function registerLedgerReconciliationJob(options: {
  readonly boss: PgBoss;
  readonly logger: JobLogger;
  readonly reconciler: LedgerReconciler;
  /** Biểu thức cron (5 trường), vd `30 2 * * *`. */
  readonly cron: string;
  /** Múi giờ IANA của biểu thức cron, vd `Asia/Ho_Chi_Minh`. */
  readonly tz: string;
}): Promise<void> {
  const { boss, logger, reconciler } = options;
  await ensureQueue(boss, LEDGER_RECONCILIATION_QUEUE, RETRY, logger);
  await boss.schedule(LEDGER_RECONCILIATION_QUEUE, options.cron, null, { tz: options.tz });
  await boss.work(LEDGER_RECONCILIATION_QUEUE, { batchSize: 1 }, async () => {
    await runLedgerReconciliation(reconciler, logger);
  });
}
