import { RECONCILIATION_CHECK_VALUES, RECONCILIATION_STATUS_VALUES } from '@tamgiao/contracts';
import { FakeClock, Money, type Result, type Tx, type UnitOfWork } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ReconciliationReportCursor,
  ReconciliationReportFilter,
  ReconciliationRepository,
} from '../application/ports/reconciliation-repository.js';
import { ListReconciliationReports } from '../application/reconciliation/list-reconciliation-reports.js';
import { ReconcileLedger } from '../application/reconciliation/reconcile-ledger.js';
import {
  findMismatches,
  RECONCILIATION_CHECKS,
  RECONCILIATION_STATUSES,
  ReconciliationReport,
  reconciliationDateOf,
  type ReconciliationReportId,
  type ReconciliationTotals,
} from '../domain/reconciliation.js';

/** Sổ khớp: 3 payment (2 đang giữ tiền, 1 đã hoàn), 3 voucher (1 ACTIVE, 1 REDEEMED, 1 VOID). */
const balanced = (over: Partial<ReconciliationTotals> = {}): ReconciliationTotals => ({
  ledgerChargeTotal: Money.ofTrusted(897_000),
  ledgerRefundTotal: Money.ofTrusted(299_000),
  heldPaymentTotal: Money.ofTrusted(598_000),
  heldPaymentCount: 2,
  voucherIssueEntries: 3,
  voucherRedeemEntries: 1,
  voucherVoidEntries: 1,
  vouchersByStatus: { RESERVED: 0, ACTIVE: 1, REDEEMED: 1, VOID: 1, EXPIRED: 0 },
  ...over,
});

describe('findMismatches', () => {
  it('sổ khớp → không có phép lệch', () => {
    expect(findMismatches(balanced())).toEqual([]);
  });

  it('CHARGE thừa → MONEY_BALANCE lệch, difference = ledger − state', () => {
    expect(findMismatches(balanced({ ledgerChargeTotal: Money.ofTrusted(1_196_000) }))).toEqual([
      { check: 'MONEY_BALANCE', ledger: 897_000n, state: 598_000n, difference: 299_000n },
    ]);
  });

  it('REFUND lớn hơn CHARGE → vế ledger âm, vẫn so được (không qua Money âm)', () => {
    const [m] = findMismatches(
      balanced({ ledgerChargeTotal: Money.ZERO, heldPaymentTotal: Money.ZERO, heldPaymentCount: 0 }),
    );
    expect(m).toEqual({ check: 'MONEY_BALANCE', ledger: -299_000n, state: 0n, difference: -299_000n });
  });

  it('voucher thiếu VOUCHER_ISSUE → VOUCHER_ISSUE_COUNT lệch (EXPIRED vẫn tính vào tổng voucher)', () => {
    const totals = balanced({
      vouchersByStatus: { RESERVED: 0, ACTIVE: 1, REDEEMED: 1, VOID: 1, EXPIRED: 1 },
    });
    expect(findMismatches(totals)).toEqual([
      { check: 'VOUCHER_ISSUE_COUNT', ledger: 3n, state: 4n, difference: -1n },
    ]);
  });

  it('VOUCHER_REDEEM / VOUCHER_VOID không khớp số voucher REDEEMED / VOID', () => {
    const mismatches = findMismatches(balanced({ voucherRedeemEntries: 2, voucherVoidEntries: 0 }));
    expect(mismatches.map((m) => [m.check, m.difference])).toEqual([
      ['VOUCHER_REDEEM_COUNT', 1n],
      ['VOUCHER_VOID_COUNT', -1n],
    ]);
  });

  it('nhiều phép lệch → theo thứ tự RECONCILIATION_CHECKS', () => {
    const mismatches = findMismatches(
      balanced({
        heldPaymentTotal: Money.ZERO,
        voucherIssueEntries: 0,
        voucherRedeemEntries: 0,
        voucherVoidEntries: 0,
      }),
    );
    expect(mismatches.map((m) => m.check)).toEqual([...RECONCILIATION_CHECKS]);
  });
});

describe('reconciliationDateOf (giờ Việt Nam UTC+7)', () => {
  it('16:59:59Z còn là ngày cũ, 17:00Z sang ngày mới', () => {
    expect(reconciliationDateOf(new Date('2026-11-18T16:59:59.999Z'))).toBe('2026-11-18');
    expect(reconciliationDateOf(new Date('2026-11-18T17:00:00.000Z'))).toBe('2026-11-19');
  });
});

describe('ReconciliationReport.compute', () => {
  const id = '019a0000-0000-7000-8000-000000000001' as ReconciliationReportId;
  const runAt = new Date('2026-11-18T19:30:00.000Z');

  it('khớp → MATCHED, ngày báo cáo theo giờ VN', () => {
    const r = ReconciliationReport.compute({ id, runAt, totals: balanced() });
    expect(r).toMatchObject({ status: 'MATCHED', reportDate: '2026-11-19', mismatches: [] });
  });

  it('lệch → MISMATCH kèm chi tiết', () => {
    const r = ReconciliationReport.compute({ id, runAt, totals: balanced({ voucherIssueEntries: 4 }) });
    expect(r.status).toBe('MISMATCH');
    expect(r.mismatches).toEqual([{ check: 'VOUCHER_ISSUE_COUNT', ledger: 4n, state: 3n, difference: 1n }]);
  });

  it('danh sách status / check khớp contracts', () => {
    expect([...RECONCILIATION_STATUS_VALUES]).toEqual([...RECONCILIATION_STATUSES]);
    expect([...RECONCILIATION_CHECK_VALUES]).toEqual([...RECONCILIATION_CHECKS]);
  });
});

// ── Use case với repository in-memory + FakeClock ────────────────────────────────────────────────

class InMemoryReconciliationRepository implements ReconciliationRepository {
  reports: ReconciliationReport[] = [];
  totals: ReconciliationTotals = balanced();
  computeCalls = 0;
  /** Mô phỏng lượt chạy song song chèn báo cáo cùng ngày ngay trước khi lượt này ghi. */
  raceWith: ReconciliationReport | null = null;

  async computeTotals(_tx: Tx): Promise<ReconciliationTotals> {
    this.computeCalls++;
    return this.totals;
  }
  async findByDate(_tx: Tx, reportDate: string): Promise<ReconciliationReport | null> {
    return this.reports.find((r) => r.reportDate === reportDate) ?? null;
  }
  async insertIfAbsent(_tx: Tx, report: ReconciliationReport): Promise<boolean> {
    if (this.raceWith !== null) {
      this.reports.push(this.raceWith);
      this.raceWith = null;
    }
    if (this.reports.some((r) => r.reportDate === report.reportDate)) return false;
    this.reports.push(report);
    return true;
  }
  async list(
    _tx: Tx,
    filter: ReconciliationReportFilter,
    cursor: ReconciliationReportCursor | null,
    limit: number,
  ): Promise<ReconciliationReport[]> {
    const key = (r: { runAt: Date; id: string }) => `${r.runAt.toISOString()}|${r.id}`;
    return [...this.reports]
      .filter((r) => filter.status === undefined || r.status === filter.status)
      .sort((a, b) => key(b).localeCompare(key(a)))
      .filter((r) => cursor === null || key(r) < key(cursor))
      .slice(0, limit);
  }
}

class PassThroughUnitOfWork implements UnitOfWork {
  runs = 0;
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    this.runs++;
    return work({} as Tx);
  }
}

describe('ReconcileLedger', () => {
  const T0 = new Date('2026-11-18T19:30:00.000Z'); // 02:30 ngày 19/11 giờ VN
  let repo: InMemoryReconciliationRepository;
  let clock: FakeClock;
  let useCase: ReconcileLedger;

  beforeEach(() => {
    repo = new InMemoryReconciliationRepository();
    clock = new FakeClock(T0);
    useCase = new ReconcileLedger({ uow: new PassThroughUnitOfWork(), clock, reconciliation: repo });
  });

  it('sổ khớp → lưu báo cáo MATCHED với runAt = Clock, ngày theo giờ VN', async () => {
    const r = await useCase.execute();
    expect(r.isOk() && r.value.kind).toBe('CREATED');
    expect(repo.reports).toHaveLength(1);
    expect(repo.reports[0]).toMatchObject({ status: 'MATCHED', reportDate: '2026-11-19', runAt: T0 });
  });

  it('sổ lệch → lưu báo cáo MISMATCH kèm chi tiết', async () => {
    repo.totals = balanced({ ledgerChargeTotal: Money.ofTrusted(1_196_000) });
    const r = await useCase.execute();
    if (!r.isOk()) throw new Error('expected ok');
    expect(r.value.report.status).toBe('MISMATCH');
    expect(r.value.report.mismatches).toEqual([
      { check: 'MONEY_BALANCE', ledger: 897_000n, state: 598_000n, difference: 299_000n },
    ]);
  });

  it('chạy lại cùng ngày → ALREADY_REPORTED, không tính lại, không ghi thêm', async () => {
    await useCase.execute();
    clock.advance({ hours: 3 });
    repo.totals = balanced({ voucherIssueEntries: 99 });
    const r = await useCase.execute();
    expect(r.isOk() && r.value.kind).toBe('ALREADY_REPORTED');
    expect(r.isOk() && r.value.report.status).toBe('MATCHED');
    expect(repo.reports).toHaveLength(1);
    expect(repo.computeCalls).toBe(1);
  });

  it('sang ngày mới (giờ VN) → báo cáo mới', async () => {
    await useCase.execute();
    clock.advance({ days: 1 });
    const r = await useCase.execute();
    expect(r.isOk() && r.value.kind).toBe('CREATED');
    expect(repo.reports.map((x) => x.reportDate)).toEqual(['2026-11-19', '2026-11-20']);
  });

  it('thua đua với lượt song song → trả báo cáo của lượt thắng', async () => {
    const winner = ReconciliationReport.compute({
      id: '019a0000-0000-7000-8000-0000000000ff' as ReconciliationReportId,
      runAt: T0,
      totals: balanced(),
    });
    repo.raceWith = winner;
    const r = await useCase.execute();
    expect(r.isOk() && r.value.kind).toBe('ALREADY_REPORTED');
    expect(r.isOk() && r.value.report.id).toBe(winner.id);
    expect(repo.reports).toHaveLength(1);
  });
});

describe('ListReconciliationReports', () => {
  it('lọc status, mới nhất trước, phân trang cursor', async () => {
    const repo = new InMemoryReconciliationRepository();
    const clock = new FakeClock(new Date('2026-11-10T19:30:00.000Z'));
    const reconcile = new ReconcileLedger({ uow: new PassThroughUnitOfWork(), clock, reconciliation: repo });
    for (let day = 0; day < 5; day++) {
      repo.totals = day % 2 === 0 ? balanced() : balanced({ voucherIssueEntries: 0 });
      await reconcile.execute();
      clock.advance({ days: 1 });
    }
    const list = new ListReconciliationReports({ uow: new PassThroughUnitOfWork(), reconciliation: repo });

    const page1 = await list.execute({ filter: {}, cursor: null, limit: 2 });
    if (!page1.isOk()) throw new Error('expected ok');
    expect(page1.value.items.map((r) => r.reportDate)).toEqual(['2026-11-15', '2026-11-14']);
    expect(page1.value.nextCursor).not.toBeNull();
    const page2 = await list.execute({ filter: {}, cursor: page1.value.nextCursor, limit: 2 });
    expect(page2.isOk() && page2.value.items.map((r) => r.reportDate)).toEqual(['2026-11-13', '2026-11-12']);

    const mismatches = await list.execute({ filter: { status: 'MISMATCH' }, cursor: null });
    expect(mismatches.isOk() && mismatches.value.items.map((r) => r.reportDate)).toEqual([
      '2026-11-14',
      '2026-11-12',
    ]);
    expect(mismatches.isOk() && mismatches.value.nextCursor).toBeNull();
  });
});
