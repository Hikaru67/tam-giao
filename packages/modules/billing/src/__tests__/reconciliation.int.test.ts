import { createLogger } from '@tamgiao/config';
import {
  problemSchema,
  reconciliationReportListResponseSchema,
  verificationCheckoutResponseSchema,
} from '@tamgiao/contracts';
import { DEPOSIT_VND, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { createDatabase, DrizzleUnitOfWork, type Database } from '@tamgiao/db';
import { createRequireAdmin, handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { FakeClock, fail, newId, ok } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createBillingModule,
  createBillingWorker,
  createLedgerReconciliationJob,
  FakePaymentGateway,
  type BillingWorker,
} from '../index.js';
import { RecordingPartnerAuditLogger } from './partner-fakes.js';

const T0 = new Date('2026-11-18T19:30:00.000Z'); // 02:30 ngày 19/11 giờ VN

let database: Database;
let uow: DrizzleUnitOfWork;
let app: Hono<AppEnv>;
let worker: BillingWorker;
const clock = new FakeClock(T0);
const gateway = new FakePaymentGateway({ secret: 'reconciliation-int-secret', clock });

/** Token admin giả: `refunder.<id>` có `billing:refund`; `reviewer.<id>` chỉ có `kyc:review`. */
const refunderToken = `refunder.${newId<'Admin'>()}`;
const reviewerToken = `reviewer.${newId<'Admin'>()}`;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const requireAdmin = createRequireAdmin(async (token) => {
    const [role, adminId] = token.split('.');
    if (adminId === undefined) return fail('UNAUTHENTICATED');
    const permissions = role === 'refunder' ? ['billing:refund'] : ['kyc:review'];
    return ok({ adminId, sessionId: newId(), role: role ?? '', permissions });
  });
  const module = createBillingModule({
    uow,
    clock,
    secret: Buffer.alloc(32, 7),
    requireUser,
    requireAdmin,
    auditLogger: new RecordingPartnerAuditLogger(),
    paymentGateway: gateway,
    paymentGatewayName: 'fake',
    paymentReturnUrl: 'tamgiao://payments/return',
  });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(createLogger({ service: 'api', level: 'silent' })));
  app.route('/', module.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);
  worker = createBillingWorker({ uow, clock, paymentGateway: gateway });
});
beforeEach(async () => {
  await resetDatabase(database.pool);
  clock.set(T0);
});
afterAll(() => database.close());

// ── Dữ liệu chèn thẳng bằng SQL (kiểm soát chính xác từng dòng ledger) ──────────────────────────────

type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED';
type VoucherStatus = 'RESERVED' | 'ACTIVE' | 'REDEEMED' | 'VOID' | 'EXPIRED';
type LedgerType = 'CHARGE' | 'REFUND' | 'VOUCHER_ISSUE' | 'VOUCHER_REDEEM' | 'VOUCHER_VOID';

async function insertPayment(status: PaymentStatus): Promise<{ paymentId: string; userId: string }> {
  const paymentId = newId();
  const userId = newId();
  const paid = status !== 'PENDING' && status !== 'FAILED';
  await database.pool.query(
    `insert into billing.payments
       (id, order_id, user_id, amount, status, gateway_txn_id, idempotency_key, created_at, updated_at, version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8, 1)`,
    [paymentId, `VP${paymentId}`, userId, DEPOSIT_VND, status, paid ? `txn-${paymentId}` : null, 'k', T0],
  );
  return { paymentId, userId };
}

async function insertVoucher(paymentId: string, userId: string, status: VoucherStatus): Promise<string> {
  const voucherId = newId();
  await database.pool.query(
    `insert into billing.vouchers (id, user_id, payment_id, value, status, issued_at, updated_at, version)
     values ($1, $2, $3, $4, $5, $6, $6, 1)`,
    [voucherId, userId, paymentId, VOUCHER_VND, status, T0],
  );
  return voucherId;
}

async function insertLedger(
  type: LedgerType,
  ref: { userId: string; paymentId?: string; voucherId?: string },
): Promise<void> {
  const isPayment = type === 'CHARGE' || type === 'REFUND';
  await database.pool.query(
    `insert into billing.ledger_entries (id, type, amount, user_id, payment_id, voucher_id, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      newId(),
      type,
      isPayment ? DEPOSIT_VND : VOUCHER_VND,
      ref.userId,
      ref.paymentId ?? null,
      ref.voucherId ?? null,
      T0,
    ],
  );
}

/** Một khoản thanh toán + voucher + đúng các bút toán mà luồng thật sinh ra (sổ khớp). */
async function consistentPurchase(
  paymentStatus: PaymentStatus,
  voucherStatus: VoucherStatus,
): Promise<{ paymentId: string; userId: string; voucherId: string }> {
  const { paymentId, userId } = await insertPayment(paymentStatus);
  const voucherId = await insertVoucher(paymentId, userId, voucherStatus);
  await insertLedger('CHARGE', { userId, paymentId });
  await insertLedger('VOUCHER_ISSUE', { userId, voucherId });
  if (paymentStatus === 'REFUNDED') await insertLedger('REFUND', { userId, paymentId });
  if (voucherStatus === 'REDEEMED') await insertLedger('VOUCHER_REDEEM', { userId, voucherId });
  if (voucherStatus === 'VOID') await insertLedger('VOUCHER_VOID', { userId, voucherId });
  return { paymentId, userId, voucherId };
}

/** Sổ khớp gồm mọi trạng thái payment / voucher. */
async function seedBalancedLedger(): Promise<void> {
  await consistentPurchase('SUCCEEDED', 'ACTIVE');
  await consistentPurchase('SUCCEEDED', 'RESERVED');
  await consistentPurchase('SUCCEEDED', 'REDEEMED');
  await consistentPurchase('SUCCEEDED', 'EXPIRED');
  await consistentPurchase('REFUND_PENDING', 'VOID');
  await consistentPurchase('REFUNDED', 'VOID');
  await insertPayment('PENDING');
  await insertPayment('FAILED');
}

async function reconcile() {
  const r = await createLedgerReconciliationJob({ uow, clock }).execute();
  if (!r.isOk()) throw new Error('expected ok');
  return r.value;
}

async function reportRows() {
  const { rows } = await database.pool.query<{
    report_date: string;
    status: string;
    ledger_charge_total: string;
    held_payment_total: string;
    mismatches: unknown;
  }>(
    `select to_char(report_date, 'YYYY-MM-DD') as report_date, status, ledger_charge_total::text,
            held_payment_total::text, mismatches
       from billing.reconciliation_reports order by run_at`,
  );
  return rows;
}

describe('ReconcileLedger (Postgres)', () => {
  it('DB trống → MATCHED, mọi tổng bằng 0', async () => {
    const outcome = await reconcile();
    expect(outcome.kind).toBe('CREATED');
    expect(outcome.report.status).toBe('MATCHED');
    expect(outcome.report.totals.ledgerChargeTotal.amount).toBe(0n);
    expect(outcome.report.totals.heldPaymentCount).toBe(0);
  });

  it('dữ liệu khớp ở mọi trạng thái → MATCHED, tổng tính đúng (bigint)', async () => {
    await seedBalancedLedger();
    const { report } = await reconcile();
    expect(report.status).toBe('MATCHED');
    expect(report.mismatches).toEqual([]);
    const deposit = BigInt(DEPOSIT_VND);
    expect(report.totals).toMatchObject({
      heldPaymentCount: 5,
      voucherIssueEntries: 6,
      voucherRedeemEntries: 1,
      voucherVoidEntries: 2,
      vouchersByStatus: { RESERVED: 1, ACTIVE: 1, REDEEMED: 1, VOID: 2, EXPIRED: 1 },
    });
    expect(report.totals.ledgerChargeTotal.amount).toBe(6n * deposit);
    expect(report.totals.ledgerRefundTotal.amount).toBe(deposit);
    expect(report.totals.heldPaymentTotal.amount).toBe(5n * deposit);

    const [row] = await reportRows();
    expect(row).toMatchObject({
      report_date: '2026-11-19',
      status: 'MATCHED',
      ledger_charge_total: (6n * deposit).toString(),
      held_payment_total: (5n * deposit).toString(),
      mismatches: [],
    });
  });

  it('AC1: chèn thẳng 1 dòng CHARGE thừa → MISMATCH MONEY_BALANCE với chênh lệch đúng', async () => {
    await seedBalancedLedger();
    const failed = await insertPayment('FAILED');
    await insertLedger('CHARGE', failed);

    const { report } = await reconcile();
    expect(report.status).toBe('MISMATCH');
    const deposit = BigInt(DEPOSIT_VND);
    expect(report.mismatches).toEqual([
      { check: 'MONEY_BALANCE', ledger: 6n * deposit, state: 5n * deposit, difference: deposit },
    ]);
    const [row] = await reportRows();
    expect(row?.status).toBe('MISMATCH');
    expect(row?.mismatches).toEqual([
      {
        check: 'MONEY_BALANCE',
        ledger: (6n * deposit).toString(),
        state: (5n * deposit).toString(),
        difference: deposit.toString(),
      },
    ]);
  });

  it('AC1: voucher không có VOUCHER_ISSUE → MISMATCH VOUCHER_ISSUE_COUNT', async () => {
    await seedBalancedLedger();
    const { paymentId, userId } = await insertPayment('SUCCEEDED');
    await insertLedger('CHARGE', { userId, paymentId });
    await insertVoucher(paymentId, userId, 'ACTIVE'); // thiếu VOUCHER_ISSUE

    const { report } = await reconcile();
    expect(report.status).toBe('MISMATCH');
    expect(report.mismatches).toEqual([
      { check: 'VOUCHER_ISSUE_COUNT', ledger: 6n, state: 7n, difference: -1n },
    ]);
  });

  it('voucher REDEEMED thiếu VOUCHER_REDEEM / VOID thiếu VOUCHER_VOID → lệch phép phụ', async () => {
    const a = await insertPayment('SUCCEEDED');
    const va = await insertVoucher(a.paymentId, a.userId, 'REDEEMED');
    await insertLedger('CHARGE', a);
    await insertLedger('VOUCHER_ISSUE', { userId: a.userId, voucherId: va });
    const b = await insertPayment('REFUND_PENDING');
    const vb = await insertVoucher(b.paymentId, b.userId, 'VOID');
    await insertLedger('CHARGE', b);
    await insertLedger('VOUCHER_ISSUE', { userId: b.userId, voucherId: vb });

    const { report } = await reconcile();
    expect(report.mismatches.map((m) => [m.check, m.difference])).toEqual([
      ['VOUCHER_REDEEM_COUNT', -1n],
      ['VOUCHER_VOID_COUNT', -1n],
    ]);
  });

  it('idempotent: chạy lại cùng ngày (giờ VN) không ghi thêm, giữ báo cáo cũ; ngày mới → báo cáo mới', async () => {
    await seedBalancedLedger();
    expect((await reconcile()).kind).toBe('CREATED');
    clock.advance({ hours: 4 }); // vẫn ngày 19/11 giờ VN
    const failed = await insertPayment('FAILED');
    await insertLedger('CHARGE', failed);
    const again = await reconcile();
    expect(again.kind).toBe('ALREADY_REPORTED');
    expect(again.report.status).toBe('MATCHED');
    expect(await reportRows()).toHaveLength(1);

    clock.advance({ days: 1 });
    const next = await reconcile();
    expect(next.kind).toBe('CREATED');
    expect(next.report.status).toBe('MISMATCH');
    expect((await reportRows()).map((r) => r.report_date)).toEqual(['2026-11-19', '2026-11-20']);
  });

  it('chạy đồng thời cùng ngày → đúng một báo cáo (unique report_date)', async () => {
    await seedBalancedLedger();
    const results = await runConcurrently(5, () => reconcile());
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const kinds = results.map((r) => (r.status === 'fulfilled' ? r.value.kind : 'FAILED'));
    expect(kinds.filter((k) => k === 'CREATED')).toHaveLength(1);
    expect(await reportRows()).toHaveLength(1);
  });

  it('DB chặn báo cáo MATCHED mà có mismatch (CHECK constraint)', async () => {
    await expect(
      database.pool.query(
        `insert into billing.reconciliation_reports
           (id, report_date, run_at, status, ledger_charge_total, ledger_refund_total, held_payment_total,
            held_payment_count, voucher_issue_entries, voucher_redeem_entries, voucher_void_entries,
            vouchers_reserved, vouchers_active, vouchers_redeemed, vouchers_void, vouchers_expired, mismatches)
         values ($1, '2026-11-19', now(), 'MATCHED', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                 '[{"check":"MONEY_BALANCE"}]'::jsonb)`,
        [newId()],
      ),
    ).rejects.toThrow(/reconciliation_reports_mismatches_ck/);
  });
});

describe('ReconcileLedger trên luồng thật (checkout → webhook → hoàn tiền)', () => {
  async function paidUser(): Promise<string> {
    const userId = newId<'User'>();
    const res = await app.request('/me/payments/verification', {
      method: 'POST',
      headers: { 'x-test-user': userId, 'idempotency-key': `key-${newId()}` },
    });
    expect(res.status).toBe(201);
    const checkout = verificationCheckoutResponseSchema.parse(await res.json());
    const hook = gateway.simulatePayment(checkout.orderId, 'SUCCEEDED');
    const delivered = await app.request('/webhooks/payments/fake', {
      method: 'POST',
      headers: hook.headers,
      body: hook.rawBody,
    });
    expect(delivered.status).toBe(200);
    return checkout.paymentId;
  }

  it('REFUND_PENDING vẫn giữ tiền; sau khi hoàn xong (REFUNDED) sổ vẫn khớp', async () => {
    await paidUser();
    const refunded = await paidUser();
    const res = await app.request(`/admin/payments/${refunded}/refund`, {
      method: 'POST',
      headers: { authorization: `Bearer ${refunderToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'test' }),
    });
    expect(res.status).toBe(202);

    const day1 = await reconcile();
    expect(day1.report.status).toBe('MATCHED');
    expect(day1.report.totals).toMatchObject({ heldPaymentCount: 2, voucherVoidEntries: 1 });

    for (const p of await worker.listPendingRefunds.execute()) {
      await worker.refundPayment.execute({ paymentId: p.paymentId });
    }
    clock.advance({ days: 1 });
    const day2 = await reconcile();
    expect(day2.report.status).toBe('MATCHED');
    expect(day2.report.totals.heldPaymentCount).toBe(1);
    expect(day2.report.totals.ledgerRefundTotal.amount).toBe(BigInt(DEPOSIT_VND));
  });
});

describe('GET /admin/billing/reconciliation-reports', () => {
  const get = (query: string, token?: string) =>
    app.request(`/admin/billing/reconciliation-reports${query}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  /** 4 ngày liên tiếp: ngày 2 và 4 lệch. */
  async function seedReports(): Promise<void> {
    await seedBalancedLedger();
    for (let day = 1; day <= 4; day++) {
      if (day === 2) {
        const extra = await insertPayment('FAILED');
        await insertLedger('CHARGE', extra);
      }
      if (day === 3) {
        // Ngày 3 khớp lại: bút toán điều chỉnh REFUND bù đúng CHARGE thừa của ngày 2.
        const { rows } = await database.pool.query<{ payment_id: string; user_id: string }>(
          `select l.payment_id, l.user_id from billing.ledger_entries l
             join billing.payments p on p.id = l.payment_id where p.status = 'FAILED'`,
        );
        const [row] = rows;
        if (row === undefined) throw new Error('missing extra charge');
        await insertLedger('REFUND', { userId: row.user_id, paymentId: row.payment_id });
      }
      if (day === 4) {
        const { paymentId, userId } = await insertPayment('SUCCEEDED');
        await insertLedger('CHARGE', { userId, paymentId });
        await insertVoucher(paymentId, userId, 'ACTIVE');
      }
      await reconcile();
      clock.advance({ days: 1 });
    }
  }

  it('không token → 401; thiếu permission billing:refund → 403', async () => {
    expect((await get('')).status).toBe(401);
    const res = await get('', reviewerToken);
    expect(res.status).toBe(403);
    expect(problemSchema.parse(await res.json()).code).toBe('FORBIDDEN');
  });

  it('admin billing:refund: mới nhất trước, lọc status, phân trang cursor; tiền dạng chuỗi', async () => {
    await seedReports();

    const all = await get('', refunderToken);
    expect(all.status).toBe(200);
    const body = reconciliationReportListResponseSchema.parse(await all.json());
    expect(body.items.map((r) => [r.reportDate, r.status])).toEqual([
      ['2026-11-22', 'MISMATCH'],
      ['2026-11-21', 'MATCHED'],
      ['2026-11-20', 'MISMATCH'],
      ['2026-11-19', 'MATCHED'],
    ]);
    expect(body.nextCursor).toBeNull();
    expect(body.items[0]?.mismatches).toEqual([
      { check: 'VOUCHER_ISSUE_COUNT', ledger: '6', state: '7', difference: '-1' },
    ]);
    expect(body.items[2]?.mismatches).toEqual([
      {
        check: 'MONEY_BALANCE',
        ledger: String(6 * DEPOSIT_VND),
        state: String(5 * DEPOSIT_VND),
        difference: String(DEPOSIT_VND),
      },
    ]);
    expect(body.items[3]?.totals.ledgerChargeTotalVnd).toBe(String(6 * DEPOSIT_VND));

    const mismatch = reconciliationReportListResponseSchema.parse(
      await (await get('?status=MISMATCH', refunderToken)).json(),
    );
    expect(mismatch.items.map((r) => r.reportDate)).toEqual(['2026-11-22', '2026-11-20']);

    const page1 = reconciliationReportListResponseSchema.parse(
      await (await get('?limit=3', refunderToken)).json(),
    );
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = reconciliationReportListResponseSchema.parse(
      await (await get(`?limit=3&cursor=${page1.nextCursor ?? ''}`, refunderToken)).json(),
    );
    expect(page2.items.map((r) => r.reportDate)).toEqual(['2026-11-19']);
    expect(page2.nextCursor).toBeNull();
  });

  it('status / cursor / limit không hợp lệ → 422 VALIDATION_FAILED', async () => {
    for (const q of ['?status=BROKEN', '?cursor=not-a-cursor', '?limit=0']) {
      const res = await get(q, refunderToken);
      expect(res.status).toBe(422);
      expect(problemSchema.parse(await res.json()).code).toBe('VALIDATION_FAILED');
    }
  });
});
