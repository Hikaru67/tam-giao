import { asDbTx } from '@tamgiao/db';
import { Money, type Tx } from '@tamgiao/kernel';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type {
  ReconciliationReportCursor,
  ReconciliationReportFilter,
  ReconciliationRepository,
} from '../application/ports/reconciliation-repository.js';
import {
  RECONCILIATION_CHECKS,
  RECONCILIATION_STATUSES,
  ReconciliationReport,
  type ReconciliationCheck,
  type ReconciliationMismatch,
  type ReconciliationReportId,
  type ReconciliationStatus,
  type ReconciliationTotals,
} from '../domain/reconciliation.js';
import { ledgerEntries, payments, reconciliationReports, vouchers } from './schema.js';

type ReportRow = typeof reconciliationReports.$inferSelect;

/** Dạng lưu của một phép lệch trong cột `mismatches` (jsonb): số nguyên lớn lưu dạng chuỗi để không mất chính xác. */
interface StoredMismatch {
  readonly check: ReconciliationCheck;
  readonly ledger: string;
  readonly state: string;
  readonly difference: string;
}

/** Kết quả câu tổng hợp — tổng tiền ép `::text` (pg trả `numeric`/`bigint` dạng chuỗi), số đếm `::int`. */
interface TotalsRow extends Record<string, unknown> {
  charge_total: string;
  refund_total: string;
  held_total: string;
  held_count: number;
  issue_entries: number;
  redeem_entries: number;
  void_entries: number;
  reserved: number;
  active: number;
  redeemed: number;
  voided: number;
  expired: number;
}

const isStatus = (v: string): v is ReconciliationStatus =>
  (RECONCILIATION_STATUSES as readonly string[]).includes(v);
const isCheck = (v: unknown): v is ReconciliationCheck =>
  typeof v === 'string' && (RECONCILIATION_CHECKS as readonly string[]).includes(v);
const isIntString = (v: unknown): v is string => typeof v === 'string' && /^-?\d+$/.test(v);

function toStoredMismatch(m: ReconciliationMismatch): StoredMismatch {
  return {
    check: m.check,
    ledger: m.ledger.toString(),
    state: m.state.toString(),
    difference: m.difference.toString(),
  };
}

function parseMismatches(id: string, raw: unknown): ReconciliationMismatch[] {
  if (!Array.isArray(raw))
    throw new Error(`billing.reconciliation_reports ${id}: mismatches không phải mảng`);
  return raw.map((item: unknown) => {
    const m = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const { check, ledger, state, difference } = m;
    if (!isCheck(check) || !isIntString(ledger) || !isIntString(state) || !isIntString(difference)) {
      throw new Error(`billing.reconciliation_reports ${id}: mismatches không hợp lệ`);
    }
    return { check, ledger: BigInt(ledger), state: BigInt(state), difference: BigInt(difference) };
  });
}

function toReport(row: ReportRow): ReconciliationReport {
  if (!isStatus(row.status)) {
    throw new Error(`billing.reconciliation_reports ${row.id}: status trong DB không hợp lệ`);
  }
  return ReconciliationReport.restore({
    id: row.id as ReconciliationReportId,
    reportDate: row.reportDate,
    runAt: row.runAt,
    status: row.status,
    totals: {
      ledgerChargeTotal: Money.ofTrusted(row.ledgerChargeTotal),
      ledgerRefundTotal: Money.ofTrusted(row.ledgerRefundTotal),
      heldPaymentTotal: Money.ofTrusted(row.heldPaymentTotal),
      heldPaymentCount: row.heldPaymentCount,
      voucherIssueEntries: row.voucherIssueEntries,
      voucherRedeemEntries: row.voucherRedeemEntries,
      voucherVoidEntries: row.voucherVoidEntries,
      vouchersByStatus: {
        RESERVED: row.vouchersReserved,
        ACTIVE: row.vouchersActive,
        REDEEMED: row.vouchersRedeemed,
        VOID: row.vouchersVoid,
        EXPIRED: row.vouchersExpired,
      },
    },
    mismatches: parseMismatches(row.id, row.mismatches),
  });
}

/** Hiện thực `ReconciliationRepository` bằng Drizzle + PostgreSQL (BE-S4-07). */
export class DrizzleReconciliationRepository implements ReconciliationRepository {
  async computeTotals(tx: Tx): Promise<ReconciliationTotals> {
    // Một câu lệnh (3 CTE tổng hợp) → một snapshot. `sum(bigint)` trả numeric → ép `::bigint` (tràn thì lỗi, không
    // làm tròn), rồi `::text` để đọc sang bigint ở app — không qua float (A8).
    const result = await asDbTx(tx).execute<TotalsRow>(sql`
      with l as (
        select
          coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.type} = 'CHARGE'), 0)::bigint as charge_total,
          coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.type} = 'REFUND'), 0)::bigint as refund_total,
          (count(*) filter (where ${ledgerEntries.type} = 'VOUCHER_ISSUE'))::int as issue_entries,
          (count(*) filter (where ${ledgerEntries.type} = 'VOUCHER_REDEEM'))::int as redeem_entries,
          (count(*) filter (where ${ledgerEntries.type} = 'VOUCHER_VOID'))::int as void_entries
        from ${ledgerEntries}
      ),
      p as (
        select coalesce(sum(${payments.amount}), 0)::bigint as held_total, count(*)::int as held_count
        from ${payments}
        where ${payments.status} in ('SUCCEEDED', 'REFUND_PENDING')
      ),
      v as (
        select
          (count(*) filter (where ${vouchers.status} = 'RESERVED'))::int as reserved,
          (count(*) filter (where ${vouchers.status} = 'ACTIVE'))::int as active,
          (count(*) filter (where ${vouchers.status} = 'REDEEMED'))::int as redeemed,
          (count(*) filter (where ${vouchers.status} = 'VOID'))::int as voided,
          (count(*) filter (where ${vouchers.status} = 'EXPIRED'))::int as expired
        from ${vouchers}
      )
      select
        l.charge_total::text as charge_total, l.refund_total::text as refund_total,
        l.issue_entries, l.redeem_entries, l.void_entries,
        p.held_total::text as held_total, p.held_count,
        v.reserved, v.active, v.redeemed, v.voided, v.expired
      from l, p, v
    `);
    const [row] = result.rows;
    if (row === undefined) throw new Error('reconciliation: câu tổng hợp không trả dòng nào');
    return {
      ledgerChargeTotal: Money.ofTrusted(BigInt(row.charge_total)),
      ledgerRefundTotal: Money.ofTrusted(BigInt(row.refund_total)),
      heldPaymentTotal: Money.ofTrusted(BigInt(row.held_total)),
      heldPaymentCount: row.held_count,
      voucherIssueEntries: row.issue_entries,
      voucherRedeemEntries: row.redeem_entries,
      voucherVoidEntries: row.void_entries,
      vouchersByStatus: {
        RESERVED: row.reserved,
        ACTIVE: row.active,
        REDEEMED: row.redeemed,
        VOID: row.voided,
        EXPIRED: row.expired,
      },
    };
  }

  async findByDate(tx: Tx, reportDate: string): Promise<ReconciliationReport | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(reconciliationReports)
      .where(eq(reconciliationReports.reportDate, reportDate));
    return row ? toReport(row) : null;
  }

  async insertIfAbsent(tx: Tx, report: ReconciliationReport): Promise<boolean> {
    const t = report.totals;
    const inserted = await asDbTx(tx)
      .insert(reconciliationReports)
      .values({
        id: report.id,
        reportDate: report.reportDate,
        runAt: report.runAt,
        status: report.status,
        ledgerChargeTotal: t.ledgerChargeTotal.amount,
        ledgerRefundTotal: t.ledgerRefundTotal.amount,
        heldPaymentTotal: t.heldPaymentTotal.amount,
        heldPaymentCount: t.heldPaymentCount,
        voucherIssueEntries: t.voucherIssueEntries,
        voucherRedeemEntries: t.voucherRedeemEntries,
        voucherVoidEntries: t.voucherVoidEntries,
        vouchersReserved: t.vouchersByStatus.RESERVED,
        vouchersActive: t.vouchersByStatus.ACTIVE,
        vouchersRedeemed: t.vouchersByStatus.REDEEMED,
        vouchersVoid: t.vouchersByStatus.VOID,
        vouchersExpired: t.vouchersByStatus.EXPIRED,
        mismatches: report.mismatches.map(toStoredMismatch),
      })
      .onConflictDoNothing({ target: reconciliationReports.reportDate })
      .returning({ id: reconciliationReports.id });
    return inserted.length > 0;
  }

  async list(
    tx: Tx,
    filter: ReconciliationReportFilter,
    cursor: ReconciliationReportCursor | null,
    limit: number,
  ): Promise<ReconciliationReport[]> {
    const conditions: SQL[] = [];
    if (filter.status !== undefined) conditions.push(eq(reconciliationReports.status, filter.status));
    if (cursor !== null) {
      conditions.push(
        sql`(${reconciliationReports.runAt}, ${reconciliationReports.id}) < (${cursor.runAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      );
    }
    const rows = await asDbTx(tx)
      .select()
      .from(reconciliationReports)
      .where(and(...conditions))
      .orderBy(desc(reconciliationReports.runAt), desc(reconciliationReports.id))
      .limit(limit);
    return rows.map(toReport);
  }
}
