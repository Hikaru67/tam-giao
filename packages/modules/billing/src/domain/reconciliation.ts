import { Entity, type Id, type Money } from '@tamgiao/kernel';
import type { VoucherStatus } from './voucher.js';

export type ReconciliationReportId = Id<'ReconciliationReport'>;

export const RECONCILIATION_STATUSES = ['MATCHED', 'MISMATCH'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

/**
 * Các phép đối soát ledger (BE-S4-07). Vế `ledger` đếm/cộng bút toán trong `billing.ledger_entries`; vế `state` lấy từ
 * trạng thái hiện tại của `billing.payments` / `billing.vouchers`.
 * - `MONEY_BALANCE`: Σ `CHARGE` − Σ `REFUND` = Σ amount của payment đang giữ tiền (`SUCCEEDED` + `REFUND_PENDING`).
 *   Ledger `REFUND` chỉ ghi khi cổng đã hoàn xong (payment `REFUNDED`), nên `REFUND_PENDING` vẫn đang giữ tiền.
 * - `VOUCHER_ISSUE_COUNT`: số `VOUCHER_ISSUE` = tổng voucher ở mọi trạng thái (mỗi voucher sinh ra kèm đúng 1 bút toán).
 * - `VOUCHER_REDEEM_COUNT`: số `VOUCHER_REDEEM` = số voucher `REDEEMED`.
 * - `VOUCHER_VOID_COUNT`: số `VOUCHER_VOID` = số voucher `VOID`.
 * Voucher `EXPIRED` không ghi ledger nên không có phép kiểm tra riêng (đã nằm trong `VOUCHER_ISSUE_COUNT`).
 */
export const RECONCILIATION_CHECKS = [
  'MONEY_BALANCE',
  'VOUCHER_ISSUE_COUNT',
  'VOUCHER_REDEEM_COUNT',
  'VOUCHER_VOID_COUNT',
] as const;
export type ReconciliationCheck = (typeof RECONCILIATION_CHECKS)[number];

/**
 * Việt Nam dùng UTC+7 cố định (không có giờ mùa hè) → ngày báo cáo theo giờ VN suy ra bằng phép cộng, không cần
 * thư viện múi giờ.
 */
const VN_UTC_OFFSET_MS = 7 * 3_600_000;

/** Ngày báo cáo (`YYYY-MM-DD`, giờ Việt Nam) của một lần chạy — khoá idempotency "mỗi ngày một báo cáo". */
export function reconciliationDateOf(runAt: Date): string {
  return new Date(runAt.getTime() + VN_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** Tổng hợp số liệu tại một thời điểm (một câu SQL — một snapshot). Tiền là `Money` (bigint, A8). */
export interface ReconciliationTotals {
  readonly ledgerChargeTotal: Money;
  readonly ledgerRefundTotal: Money;
  /** Σ amount payment `SUCCEEDED` + `REFUND_PENDING`. */
  readonly heldPaymentTotal: Money;
  readonly heldPaymentCount: number;
  readonly voucherIssueEntries: number;
  readonly voucherRedeemEntries: number;
  readonly voucherVoidEntries: number;
  readonly vouchersByStatus: Readonly<Record<VoucherStatus, number>>;
}

/** Một phép đối soát lệch: giá trị theo ledger, theo trạng thái, và chênh lệch `ledger − state`. */
export interface ReconciliationMismatch {
  readonly check: ReconciliationCheck;
  readonly ledger: bigint;
  readonly state: bigint;
  readonly difference: bigint;
}

export interface ReconciliationReportProps {
  readonly id: ReconciliationReportId;
  readonly reportDate: string;
  readonly runAt: Date;
  readonly totals: ReconciliationTotals;
  readonly status: ReconciliationStatus;
  readonly mismatches: readonly ReconciliationMismatch[];
}

const totalVouchers = (byStatus: Readonly<Record<VoucherStatus, number>>): number =>
  byStatus.RESERVED + byStatus.ACTIVE + byStatus.REDEEMED + byStatus.VOID + byStatus.EXPIRED;

/** Tính các phép đối soát từ số liệu tổng hợp; trả danh sách phép lệch theo thứ tự `RECONCILIATION_CHECKS`. */
export function findMismatches(totals: ReconciliationTotals): ReconciliationMismatch[] {
  const pairs: Record<ReconciliationCheck, { ledger: bigint; state: bigint }> = {
    MONEY_BALANCE: {
      ledger: totals.ledgerChargeTotal.amount - totals.ledgerRefundTotal.amount,
      state: totals.heldPaymentTotal.amount,
    },
    VOUCHER_ISSUE_COUNT: {
      ledger: BigInt(totals.voucherIssueEntries),
      state: BigInt(totalVouchers(totals.vouchersByStatus)),
    },
    VOUCHER_REDEEM_COUNT: {
      ledger: BigInt(totals.voucherRedeemEntries),
      state: BigInt(totals.vouchersByStatus.REDEEMED),
    },
    VOUCHER_VOID_COUNT: {
      ledger: BigInt(totals.voucherVoidEntries),
      state: BigInt(totals.vouchersByStatus.VOID),
    },
  };
  return RECONCILIATION_CHECKS.flatMap((check) => {
    const { ledger, state } = pairs[check];
    return ledger === state ? [] : [{ check, ledger, state, difference: ledger - state }];
  });
}

/**
 * Báo cáo đối soát ledger hằng ngày (BE-S4-07) — bất biến sau khi tạo (không có method thay đổi).
 * `status = MISMATCH` khi và chỉ khi có ít nhất một phép lệch.
 */
export class ReconciliationReport extends Entity<ReconciliationReportId> {
  readonly reportDate: string;
  readonly runAt: Date;
  readonly totals: ReconciliationTotals;
  readonly status: ReconciliationStatus;
  readonly mismatches: readonly ReconciliationMismatch[];

  private constructor(props: ReconciliationReportProps) {
    super(props.id);
    this.reportDate = props.reportDate;
    this.runAt = props.runAt;
    this.totals = props.totals;
    this.status = props.status;
    this.mismatches = props.mismatches;
  }

  /** Lập báo cáo từ số liệu tổng hợp tại `runAt`. */
  static compute(input: {
    readonly id: ReconciliationReportId;
    readonly runAt: Date;
    readonly totals: ReconciliationTotals;
  }): ReconciliationReport {
    const mismatches = findMismatches(input.totals);
    return new ReconciliationReport({
      id: input.id,
      reportDate: reconciliationDateOf(input.runAt),
      runAt: input.runAt,
      totals: input.totals,
      status: mismatches.length === 0 ? 'MATCHED' : 'MISMATCH',
      mismatches,
    });
  }

  /** Dựng lại từ DB (repository) — dữ liệu tin cậy. */
  static restore(props: ReconciliationReportProps): ReconciliationReport {
    return new ReconciliationReport(props);
  }
}
