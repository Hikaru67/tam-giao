import { newId, ok, type Clock, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { ReconciliationReport, reconciliationDateOf } from '../../domain/reconciliation.js';
import type { ReconciliationRepository } from '../ports/reconciliation-repository.js';
import { toReconciliationReportView, type ReconciliationReportView } from './reconciliation-views.js';

/**
 * - `CREATED`: đã lập và lưu báo cáo của ngày (status `MATCHED | MISMATCH`).
 * - `ALREADY_REPORTED`: ngày (giờ VN) đã có báo cáo → giữ nguyên báo cáo cũ, không ghi thêm (idempotent).
 */
export type ReconcileLedgerOutcome =
  | { readonly kind: 'CREATED'; readonly report: ReconciliationReportView }
  | { readonly kind: 'ALREADY_REPORTED'; readonly report: ReconciliationReportView };

export interface ReconcileLedgerDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly reconciliation: ReconciliationRepository;
}

/**
 * Job đối soát ledger hằng ngày (BE-S4-07). Một transaction: đã có báo cáo của ngày → trả lại; chưa có → tính tổng
 * (một câu SQL) → lập báo cáo → `insertIfAbsent` (lượt chạy song song thua đua unique `report_date` → đọc lại báo
 * cáo của lượt thắng). Thời gian lấy từ `Clock` (A7). Ghi log (error khi lệch) là việc của người gọi (worker).
 */
export class ReconcileLedger {
  constructor(private readonly deps: ReconcileLedgerDeps) {}

  async execute(): Promise<Result<ReconcileLedgerOutcome, never>> {
    const runAt = this.deps.clock.now();
    const reportDate = reconciliationDateOf(runAt);
    const repo = this.deps.reconciliation;
    return this.deps.uow.run(async (tx) => {
      const existing = await repo.findByDate(tx, reportDate);
      if (existing !== null)
        return ok<ReconcileLedgerOutcome>({
          kind: 'ALREADY_REPORTED',
          report: toReconciliationReportView(existing),
        });

      const totals = await repo.computeTotals(tx);
      const report = ReconciliationReport.compute({ id: newId<'ReconciliationReport'>(), runAt, totals });
      if (await repo.insertIfAbsent(tx, report))
        return ok<ReconcileLedgerOutcome>({ kind: 'CREATED', report: toReconciliationReportView(report) });

      const winner = await repo.findByDate(tx, reportDate);
      if (winner === null)
        throw new Error(`reconciliation_reports ${reportDate}: xung đột nhưng không đọc được`);
      return ok<ReconcileLedgerOutcome>({
        kind: 'ALREADY_REPORTED',
        report: toReconciliationReportView(winner),
      });
    });
  }
}
