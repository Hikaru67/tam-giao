import { createLogger } from '@tamgiao/config';
import {
  adminRefundResponseSchema,
  KYC_APPROVED,
  KYC_REJECTED,
  problemSchema,
  verificationCheckoutResponseSchema,
} from '@tamgiao/contracts';
import { DEPOSIT_VND, REFUND_SLA_HOURS, VOUCHER_TTL_DAYS, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { createDatabase, deliverOnce, DrizzleUnitOfWork, EventBus, type Database } from '@tamgiao/db';
import { createRequireAdmin, handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { addDuration, FakeClock, fail, newId, ok, type DomainEvent } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createBillingModule,
  createBillingWorker,
  FakePaymentGateway,
  PaymentGatewayError,
  REFUND_ON_KYC_REJECTED_CONSUMER,
  SET_VOUCHER_EXPIRY_CONSUMER,
  type BillingWorker,
} from '../index.js';
import { RecordingPartnerAuditLogger } from './partner-fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');

let database: Database;
let app: Hono<AppEnv>;
let worker: BillingWorker;
let uow: DrizzleUnitOfWork;
const bus = new EventBus();
const clock = new FakeClock(T0);
// Cùng một instance cho API (webhook) và worker (refund) → fake biết giao dịch, không cần `acceptUnknownRefunds`.
const gateway = new FakePaymentGateway({ secret: 'refund-int-test-secret', clock });
const audit = new RecordingPartnerAuditLogger();

/** Token admin giả: `refunder.<id>` có `billing:refund`; `reviewer.<id>` chỉ có `kyc:review`. */
const REFUNDER = newId<'Admin'>();
const refunderToken = `refunder.${REFUNDER}`;
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
    secret: Buffer.alloc(32, 5),
    requireUser,
    requireAdmin,
    auditLogger: audit,
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
  worker.registerConsumers(bus);
});
beforeEach(async () => {
  await resetDatabase(database.pool);
  clock.set(T0);
  audit.entries = [];
  gateway.failNextRefunds(0);
});
afterAll(() => database.close());

/** Thanh toán xác thực thành công qua HTTP thật: checkout → webhook đã ký. */
async function paidUser(): Promise<{ userId: string; paymentId: string; gatewayTxnId: string }> {
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
  const { gatewayTxnId } = JSON.parse(hook.rawBody) as { gatewayTxnId: string };
  return { userId, paymentId: checkout.paymentId, gatewayTxnId };
}

const kycEvent = (type: string, userId: string, occurredAt = clock.now()): DomainEvent => ({
  eventId: newId(),
  type,
  aggregateType: 'KycSubmission',
  aggregateId: newId(),
  version: 5,
  occurredAt,
  payload: { submissionId: newId(), userId, ...(type === KYC_REJECTED ? { reasonCode: 'OTHER' } : {}) },
});

function subscription(eventType: string) {
  const [sub] = bus.consumersOf(eventType);
  if (sub === undefined) throw new Error(`no consumer for ${eventType}`);
  return sub;
}

/** Một lượt worker: điều phối REFUND_PENDING → chạy job hoàn tiền từng khoản. */
async function runRefundSweep(): Promise<void> {
  for (const p of await worker.listPendingRefunds.execute()) {
    await worker.refundPayment.execute({ paymentId: p.paymentId });
  }
}

async function paymentRow(paymentId: string) {
  const { rows } = await database.pool.query<{ status: string; refund_requested_at: Date | null }>(
    'select status, refund_requested_at from billing.payments where id = $1',
    [paymentId],
  );
  return rows[0];
}

async function ledgerTypes(paymentId: string): Promise<string[]> {
  const { rows } = await database.pool.query<{ type: string; amount: string }>(
    'select type, amount::text as amount from billing.ledger_entries where payment_id = $1 order by type',
    [paymentId],
  );
  return rows.map((r) => `${r.type}:${r.amount}`);
}

async function outboxTypes(): Promise<string[]> {
  const { rows } = await database.pool.query<{ event_type: string }>(
    `select event_type from platform.outbox
      where event_type in ('RefundCompleted', 'VoucherVoided') order by event_type`,
  );
  return rows.map((r) => r.event_type);
}

describe('consumer billing.refund-on-kyc-rejected + job hoàn tiền (Postgres)', () => {
  it('AC1: cùng event KycRejected giao 2 lần (+ event phát lại) → 1 lần gọi refund, REFUNDED, ledger đủ', async () => {
    const { userId, paymentId, gatewayTxnId } = await paidUser();
    const sub = subscription(KYC_REJECTED);
    expect(sub.consumer).toBe(REFUND_ON_KYC_REJECTED_CONSUMER);
    const event = kycEvent(KYC_REJECTED, userId);

    expect(await deliverOnce(uow, sub, event)).toBe(true);
    expect(await deliverOnce(uow, sub, event)).toBe(false); // processed_events chặn
    expect(await deliverOnce(uow, sub, kycEvent(KYC_REJECTED, userId))).toBe(true); // không còn SUCCEEDED → bỏ qua
    expect(await paymentRow(paymentId)).toEqual({ status: 'REFUND_PENDING', refund_requested_at: T0 });
    expect(gateway.refundCalls).toHaveLength(0); // consumer không gọi cổng

    await runRefundSweep();
    await runRefundSweep();
    await worker.refundPayment.execute({ paymentId });

    expect(gateway.refundCalls.filter((c) => c.gatewayTxnId === gatewayTxnId)).toEqual([
      { gatewayTxnId, amount: BigInt(DEPOSIT_VND), succeeded: true },
    ]);
    expect((await paymentRow(paymentId))?.status).toBe('REFUNDED');
    expect(await ledgerTypes(paymentId)).toEqual([
      `CHARGE:${DEPOSIT_VND}`,
      `REFUND:${DEPOSIT_VND}`,
      `VOUCHER_ISSUE:${VOUCHER_VND}`,
      `VOUCHER_VOID:${VOUCHER_VND}`,
    ]);
    const { rows } = await database.pool.query('select status, void_reason from billing.vouchers');
    expect(rows).toEqual([{ status: 'VOID', void_reason: 'PAYMENT_REFUNDED' }]);
    expect(await outboxTypes()).toEqual(['RefundCompleted', 'VoucherVoided']);
  });

  it('2 event KycRejected khác nhau xử lý đồng thời → chỉ 1 lần chuyển REFUND_PENDING / 1 VOUCHER_VOID', async () => {
    const { userId, paymentId } = await paidUser();
    const sub = subscription(KYC_REJECTED);
    const results = await runConcurrently(3, () => deliverOnce(uow, sub, kycEvent(KYC_REJECTED, userId)));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect((await paymentRow(paymentId))?.status).toBe('REFUND_PENDING');
    expect(await ledgerTypes(paymentId)).toEqual([
      `CHARGE:${DEPOSIT_VND}`,
      `VOUCHER_ISSUE:${VOUCHER_VND}`,
      `VOUCHER_VOID:${VOUCHER_VND}`,
    ]);
  });

  it('người dùng chưa thanh toán → consumer bỏ qua, không lỗi', async () => {
    expect(await deliverOnce(uow, subscription(KYC_REJECTED), kycEvent(KYC_REJECTED, newId()))).toBe(true);
    expect(await worker.listPendingRefunds.execute()).toEqual([]);
  });

  it('AC2: cổng lỗi tạm thời 2 lần → retry, cuối cùng REFUNDED (1 ledger REFUND)', async () => {
    const { userId, paymentId } = await paidUser();
    await deliverOnce(uow, subscription(KYC_REJECTED), kycEvent(KYC_REJECTED, userId));
    gateway.failNextRefunds(2, 'UNAVAILABLE');

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(worker.refundPayment.execute({ paymentId })).rejects.toBeInstanceOf(PaymentGatewayError);
      expect((await paymentRow(paymentId))?.status).toBe('REFUND_PENDING');
    }
    await worker.refundPayment.execute({ paymentId });
    expect((await paymentRow(paymentId))?.status).toBe('REFUNDED');
    expect((await ledgerTypes(paymentId)).filter((t) => t.startsWith('REFUND:'))).toHaveLength(1);
  });

  it('AC3: REFUND_PENDING quá REFUND_SLA_HOURS → FindOverdueRefunds trả về (để log error)', async () => {
    const { userId, paymentId } = await paidUser();
    await deliverOnce(uow, subscription(KYC_REJECTED), kycEvent(KYC_REJECTED, userId));
    clock.set(addDuration(T0, { hours: REFUND_SLA_HOURS, seconds: -1 }));
    expect(await worker.findOverdueRefunds.execute()).toEqual([]);
    clock.set(addDuration(T0, { hours: REFUND_SLA_HOURS }));
    expect(await worker.findOverdueRefunds.execute()).toEqual([
      { paymentId, refundRequestedAt: T0, hoursPending: REFUND_SLA_HOURS },
    ]);
  });
});

describe('consumer billing.set-voucher-expiry (Postgres)', () => {
  it('KycApproved → expires_at = occurredAt + VOUCHER_TTL_DAYS; event khác giao lại → giữ nguyên', async () => {
    const { userId } = await paidUser();
    const sub = subscription(KYC_APPROVED);
    expect(sub.consumer).toBe(SET_VOUCHER_EXPIRY_CONSUMER);
    const approvedAt = addDuration(T0, { hours: 2 });
    clock.set(addDuration(T0, { hours: 3 }));
    await deliverOnce(uow, sub, kycEvent(KYC_APPROVED, userId, approvedAt));
    await deliverOnce(uow, sub, kycEvent(KYC_APPROVED, userId, addDuration(T0, { days: 1 })));

    const { rows } = await database.pool.query<{ status: string; expires_at: Date }>(
      'select status, expires_at from billing.vouchers where user_id = $1',
      [userId],
    );
    expect(rows).toEqual([
      { status: 'RESERVED', expires_at: addDuration(approvedAt, { days: VOUCHER_TTL_DAYS }) },
    ]);
  });
});

describe('POST /admin/payments/:id/refund', () => {
  const refund = (paymentId: string, token: string | null, body: unknown = { reason: 'Khách khiếu nại' }) =>
    app.request(`/admin/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
  const code = async (res: Response) => problemSchema.parse(await res.json()).code;

  it('quyền billing:refund + lý do → 202 REFUND_PENDING, audit; job hoàn tiền xong → REFUNDED', async () => {
    const { paymentId } = await paidUser();
    const res = await refund(paymentId, refunderToken, { reason: '  Khách khiếu nại  ' });
    expect(res.status).toBe(202);
    expect(adminRefundResponseSchema.parse(await res.json())).toEqual({
      paymentId,
      status: 'REFUND_PENDING',
      refundRequestedAt: T0.toISOString(),
      voucherVoided: true,
    });
    expect(audit.entries).toEqual([
      expect.objectContaining({
        actor: { type: 'admin', id: REFUNDER },
        action: 'billing.refund_request',
        targetType: 'payment',
        targetId: paymentId,
        meta: { reason: 'Khách khiếu nại', previousStatus: 'SUCCEEDED', voucherVoided: true },
      }),
    ]);

    await runRefundSweep();
    expect((await paymentRow(paymentId))?.status).toBe('REFUNDED');

    const again = await refund(paymentId, refunderToken);
    expect(again.status).toBe(409);
    expect(await code(again)).toBe('PAYMENT_ALREADY_REFUNDED');
    expect(audit.entries).toHaveLength(1);
  });

  it('chưa đăng nhập → 401; thiếu quyền → 403; không ghi gì', async () => {
    const { paymentId } = await paidUser();
    expect((await refund(paymentId, null)).status).toBe(401);
    const forbidden = await refund(paymentId, reviewerToken);
    expect(forbidden.status).toBe(403);
    expect(await code(forbidden)).toBe('FORBIDDEN');
    expect((await paymentRow(paymentId))?.status).toBe('SUCCEEDED');
    expect(audit.entries).toEqual([]);
  });

  it('thiếu / rỗng lý do → 422; payment không tồn tại → 404', async () => {
    const { paymentId } = await paidUser();
    for (const body of [{}, { reason: '   ' }, { reason: 'x'.repeat(501) }]) {
      const res = await refund(paymentId, refunderToken, body);
      expect(res.status).toBe(422);
      expect(await code(res)).toBe('VALIDATION_FAILED');
    }
    expect((await paymentRow(paymentId))?.status).toBe('SUCCEEDED');
    const missing = await refund(newId(), refunderToken);
    expect(missing.status).toBe(404);
    expect(await code(missing)).toBe('PAYMENT_NOT_FOUND');
    expect(audit.entries).toEqual([]);
  });
});
