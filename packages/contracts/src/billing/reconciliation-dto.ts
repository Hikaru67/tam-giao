import { z } from 'zod';

/**
 * DTO báo cáo đối soát ledger (BE-S4-07) — `GET /admin/billing/reconciliation-reports`.
 * Tiền / chênh lệch trả dạng **chuỗi số nguyên** (bigint) để không mất chính xác khi tổng lớn; số đếm là `number`.
 */

/** Khớp `RECONCILIATION_STATUSES` của domain billing (có test đối chiếu). */
export const RECONCILIATION_STATUS_VALUES = ['MATCHED', 'MISMATCH'] as const;
/** Khớp `RECONCILIATION_CHECKS` của domain billing (có test đối chiếu). */
export const RECONCILIATION_CHECK_VALUES = [
  'MONEY_BALANCE',
  'VOUCHER_ISSUE_COUNT',
  'VOUCHER_REDEEM_COUNT',
  'VOUCHER_VOID_COUNT',
] as const;

const bigintString = z.string().regex(/^-?\d+$/);

export const reconciliationReportQuerySchema = z.object({
  status: z.enum(RECONCILIATION_STATUS_VALUES).optional(),
  /** `nextCursor` của trang trước. */
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ReconciliationReportQuery = z.infer<typeof reconciliationReportQuerySchema>;

export const reconciliationReportSchema = z.object({
  id: z.uuid(),
  /** Ngày báo cáo theo giờ Việt Nam (`YYYY-MM-DD`). */
  reportDate: z.iso.date(),
  /** Thời điểm chạy = mốc as-of của các tổng (tích luỹ từ đầu). */
  runAt: z.iso.datetime(),
  status: z.enum(RECONCILIATION_STATUS_VALUES),
  totals: z.object({
    ledgerChargeTotalVnd: bigintString,
    ledgerRefundTotalVnd: bigintString,
    /** Σ payment `SUCCEEDED` + `REFUND_PENDING`. */
    heldPaymentTotalVnd: bigintString,
    heldPaymentCount: z.number().int(),
    voucherIssueEntries: z.number().int(),
    voucherRedeemEntries: z.number().int(),
    voucherVoidEntries: z.number().int(),
    vouchersByStatus: z.object({
      RESERVED: z.number().int(),
      ACTIVE: z.number().int(),
      REDEEMED: z.number().int(),
      VOID: z.number().int(),
      EXPIRED: z.number().int(),
    }),
  }),
  /** Rỗng khi `MATCHED`. `difference = ledger − state`. */
  mismatches: z.array(
    z.object({
      check: z.enum(RECONCILIATION_CHECK_VALUES),
      ledger: bigintString,
      state: bigintString,
      difference: bigintString,
    }),
  ),
});
export type ReconciliationReportDto = z.infer<typeof reconciliationReportSchema>;

export const reconciliationReportListResponseSchema = z.object({
  items: z.array(reconciliationReportSchema),
  /** `null` khi hết dữ liệu. */
  nextCursor: z.string().nullable(),
});
export type ReconciliationReportListResponse = z.infer<typeof reconciliationReportListResponseSchema>;
