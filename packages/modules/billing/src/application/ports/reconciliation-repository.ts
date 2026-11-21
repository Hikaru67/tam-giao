import type { Tx } from '@tamgiao/kernel';
import type {
  ReconciliationReport,
  ReconciliationStatus,
  ReconciliationTotals,
} from '../../domain/reconciliation.js';

/** Vị trí phân trang: báo cáo mới nhất trước theo (`runAt`, `id`). */
export interface ReconciliationReportCursor {
  readonly runAt: Date;
  readonly id: string;
}

export interface ReconciliationReportFilter {
  readonly status?: ReconciliationStatus;
}

/** Đối soát ledger (BE-S4-07) trên `billing.ledger_entries` / `payments` / `vouchers` + `reconciliation_reports`. */
export interface ReconciliationRepository {
  /**
   * Số liệu tổng hợp tính **trong DB** bằng SUM/COUNT (không tải từng dòng lên app), trong **một câu lệnh** để mọi
   * tổng cùng một snapshot (tránh báo lệch giả khi có giao dịch chen giữa hai câu).
   */
  computeTotals(tx: Tx): Promise<ReconciliationTotals>;
  /** Báo cáo của ngày (`YYYY-MM-DD`, giờ VN), nếu đã có. */
  findByDate(tx: Tx, reportDate: string): Promise<ReconciliationReport | null>;
  /** Ghi báo cáo; `false` nếu ngày đó đã có báo cáo (unique `report_date`) — không ghi đè. */
  insertIfAbsent(tx: Tx, report: ReconciliationReport): Promise<boolean>;
  /** Mới nhất trước; lấy tối đa `limit` dòng sau `cursor`. */
  list(
    tx: Tx,
    filter: ReconciliationReportFilter,
    cursor: ReconciliationReportCursor | null,
    limit: number,
  ): Promise<ReconciliationReport[]>;
}
