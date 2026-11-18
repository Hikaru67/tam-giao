import { errorRegistry } from '@tamgiao/contracts';
import { DEPOSIT_VND, REFUND_SLA_HOURS, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { FakeClock, addDuration, newId, type Result } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { PaymentGatewayError } from '../application/ports/payment-gateway.js';
import { RefundOnKycRejected } from '../application/refund/refund-on-kyc-rejected.js';
import { FindOverdueRefunds, ListPendingRefunds } from '../application/refund/refund-queries.js';
import { RefundVerificationPayment } from '../application/refund/refund-verification-payment.js';
import {
  MANUAL_REFUND_AUDIT_ACTION,
  RequestManualRefund,
} from '../application/refund/request-manual-refund.js';
import { REFUND_VOUCHER_VOID_REASON } from '../application/refund/start-refund.js';
import { BILLING_REFUND_ERRORS } from '../domain/refund-errors.js';
import { VerificationPayment } from '../domain/verification-payment.js';
import { Voucher } from '../domain/voucher.js';
import { FakePaymentGateway } from '../infrastructure/gateway/fake-payment-gateway.js';
import { RecordingPartnerAuditLogger } from './partner-fakes.js';
import { FakeBillingUnitOfWork, InMemoryBillingStore } from './payment-fakes.js';
import { refundPaymentRepo, refundVoucherRepo, seedPaidUser } from './refund-fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const TX = {} as never;

function unwrap<T, E>(r: Result<T, E>): T {
  if (r.isErr()) throw new Error(`expected Ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

let store: InMemoryBillingStore;
let uow: FakeBillingUnitOfWork;
let clock: FakeClock;
let gateway: FakePaymentGateway;
let audit: RecordingPartnerAuditLogger;

function build() {
  const payments = refundPaymentRepo(store);
  const vouchers = refundVoucherRepo(store);
  const ledger = store.ledgerRepo;
  return {
    consumer: new RefundOnKycRejected({ clock, payments, vouchers, ledger }),
    refund: new RefundVerificationPayment({ uow, clock, gateway, payments, ledger }),
    manual: new RequestManualRefund({ uow, clock, auditLogger: audit, payments, vouchers, ledger }),
    listPending: new ListPendingRefunds({ uow, payments }),
    findOverdue: new FindOverdueRefunds({ uow, clock, payments }),
  };
}

beforeEach(() => {
  store = new InMemoryBillingStore();
  uow = new FakeBillingUnitOfWork(store);
  clock = new FakeClock(T0);
  gateway = new FakePaymentGateway({ secret: 'unit-test-secret', clock, acceptUnknownRefunds: true });
  audit = new RecordingPartnerAuditLogger();
});

describe('RefundOnKycRejected (consumer KycRejected)', () => {
  it('SUCCEEDED → REFUND_PENDING, voucher VOID + ledger VOUCHER_VOID; không gọi cổng', async () => {
    const { userId, payment, voucher } = seedPaidUser(store, clock);
    clock.advance({ minutes: 5 });
    const r = await build().consumer.handle(TX, { userId });

    expect(unwrap(r)).toEqual({ kind: 'REFUND_REQUESTED', paymentId: payment.id, voucherVoided: true });
    expect(store.get(payment.id)).toMatchObject({ status: 'REFUND_PENDING', refundRequestedAt: clock.now() });
    expect(store.vouchers.get(voucher.id)).toMatchObject({
      status: 'VOID',
      voidReason: REFUND_VOUCHER_VOID_REASON,
    });
    expect(store.ledger.map((e) => [e.type, e.amount.amount, e.voucherId])).toEqual([
      ['VOUCHER_VOID', BigInt(VOUCHER_VND), voucher.id],
    ]);
    expect(store.events.map((e) => e.type)).toEqual(['VoucherVoided']);
    expect(gateway.refundCalls).toHaveLength(0);
  });

  it('xử lý lại (event lặp) → NO_REFUNDABLE_PAYMENT, không ghi thêm', async () => {
    const { userId } = seedPaidUser(store, clock);
    const { consumer } = build();
    await consumer.handle(TX, { userId });
    const again = await consumer.handle(TX, { userId });
    expect(unwrap(again)).toEqual({ kind: 'NO_REFUNDABLE_PAYMENT' });
    expect(store.ledger).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });

  it('người dùng chưa thanh toán → bỏ qua', async () => {
    const r = await build().consumer.handle(TX, { userId: newId<'User'>() });
    expect(unwrap(r)).toEqual({ kind: 'NO_REFUNDABLE_PAYMENT' });
  });

  it('voucher đã VOID → vẫn hoàn tiền, không ghi VOUCHER_VOID lần nữa', async () => {
    const { userId, payment, voucher } = seedPaidUser(store, clock);
    const v = Voucher.restore(voucher.toState());
    v.void('MANUAL', clock.now());
    store.vouchers.set(v.id, v.toState());
    const r = await build().consumer.handle(TX, { userId });
    expect(unwrap(r)).toMatchObject({ kind: 'REFUND_REQUESTED', voucherVoided: false });
    expect(store.get(payment.id).status).toBe('REFUND_PENDING');
    expect(store.ledger).toHaveLength(0);
  });

  it('voucher đã REDEEMED → VOUCHER_ALREADY_REDEEMED (người gọi rollback)', async () => {
    const { userId, voucher } = seedPaidUser(store, clock);
    store.vouchers.set(voucher.id, { ...voucher.toState(), status: 'REDEEMED' });
    const r = await build().consumer.handle(TX, { userId });
    expect(r.isErr() && r.error.code).toBe('VOUCHER_ALREADY_REDEEMED');
  });
});

describe('RefundVerificationPayment (job)', () => {
  async function pendingRefund(gatewayTxnId?: string) {
    const seeded = seedPaidUser(store, clock, gatewayTxnId === undefined ? {} : { gatewayTxnId });
    await build().consumer.handle(TX, { userId: seeded.userId });
    store.events.length = 0;
    return seeded;
  }

  it('REFUND_PENDING → gọi cổng đúng giao dịch/số tiền → REFUNDED + ledger REFUND + RefundCompleted', async () => {
    const { payment } = await pendingRefund('txn_ok');
    clock.advance({ minutes: 1 });
    const r = await build().refund.execute({ paymentId: payment.id });

    expect(unwrap(r)).toEqual({ kind: 'REFUNDED', paymentId: payment.id });
    expect(gateway.refundCalls).toEqual([
      { gatewayTxnId: 'txn_ok', amount: BigInt(DEPOSIT_VND), succeeded: true },
    ]);
    expect(store.get(payment.id)).toMatchObject({ status: 'REFUNDED', refundedAt: clock.now() });
    const refund = store.ledger.filter((e) => e.type === 'REFUND');
    expect(refund.map((e) => [e.amount.amount, e.paymentId])).toEqual([[BigInt(DEPOSIT_VND), payment.id]]);
    expect(store.events.map((e) => [e.type, e.aggregateId])).toEqual([['RefundCompleted', payment.id]]);
  });

  it('chạy lại sau khi đã hoàn → SKIPPED, không gọi cổng lần 2', async () => {
    const { payment } = await pendingRefund();
    const { refund } = build();
    await refund.execute({ paymentId: payment.id });
    const again = await refund.execute({ paymentId: payment.id });
    expect(unwrap(again)).toEqual({ kind: 'SKIPPED', paymentId: payment.id, status: 'REFUNDED' });
    expect(gateway.refundCalls).toHaveLength(1);
  });

  it('AC2: cổng lỗi tạm thời → throw retryable (giữ REFUND_PENDING), lần thử lại cuối cùng REFUNDED', async () => {
    const { payment } = await pendingRefund();
    gateway.failNextRefunds(2, 'TIMEOUT');
    const { refund } = build();

    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await refund.execute({ paymentId: payment.id }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect((error as PaymentGatewayError).retryable).toBe(true);
      expect(store.get(payment.id).status).toBe('REFUND_PENDING');
    }
    const r = await refund.execute({ paymentId: payment.id });
    expect(unwrap(r).kind).toBe('REFUNDED');
    expect(store.get(payment.id).status).toBe('REFUNDED');
    expect(gateway.refundCalls.map((c) => c.succeeded)).toEqual([false, false, true]);
    expect(store.ledger.filter((e) => e.type === 'REFUND')).toHaveLength(1);
  });

  it('cổng từ chối vĩnh viễn → GATEWAY_REJECTED, giữ REFUND_PENDING, không ghi ledger REFUND', async () => {
    gateway = new FakePaymentGateway({ secret: 'unit-test-secret', clock }); // không biết giao dịch → REJECTED
    const { payment } = await pendingRefund();
    const r = await build().refund.execute({ paymentId: payment.id });
    expect(unwrap(r)).toEqual({
      kind: 'GATEWAY_REJECTED',
      paymentId: payment.id,
      gatewayErrorKind: 'REJECTED',
    });
    expect(store.get(payment.id).status).toBe('REFUND_PENDING');
    expect(store.ledger.filter((e) => e.type === 'REFUND')).toHaveLength(0);
  });

  it('khoản chưa yêu cầu hoàn / id sai / không tồn tại → SKIPPED, không gọi cổng', async () => {
    const { payment } = seedPaidUser(store, clock);
    const { refund } = build();
    expect(unwrap(await refund.execute({ paymentId: payment.id }))).toMatchObject({
      kind: 'SKIPPED',
      status: 'SUCCEEDED',
    });
    expect(unwrap(await refund.execute({ paymentId: 'not-a-uuid' }))).toMatchObject({ kind: 'SKIPPED' });
    expect(unwrap(await refund.execute({ paymentId: newId() }))).toMatchObject({
      kind: 'SKIPPED',
      status: null,
    });
    expect(gateway.refundCalls).toHaveLength(0);
  });

  it('AC1: KycRejected xử lý 2 lần + điều phối/job chạy lặp → chỉ 1 lần gọi refund', async () => {
    const { userId, payment } = seedPaidUser(store, clock);
    const { consumer, listPending, refund } = build();
    await consumer.handle(TX, { userId });
    await consumer.handle(TX, { userId });
    for (let sweep = 0; sweep < 2; sweep++) {
      for (const p of await listPending.execute()) await refund.execute({ paymentId: p.paymentId });
    }
    await refund.execute({ paymentId: payment.id });
    expect(gateway.refundCalls).toHaveLength(1);
    expect(store.get(payment.id).status).toBe('REFUNDED');
  });
});

describe('ListPendingRefunds / FindOverdueRefunds (AC3)', () => {
  it('liệt kê REFUND_PENDING; quá hạn tính từ refundRequestedAt, đúng mốc REFUND_SLA_HOURS là quá hạn', async () => {
    const { userId, payment } = seedPaidUser(store, clock);
    seedPaidUser(store, clock); // khoản SUCCEEDED khác — không liệt kê
    const { consumer, listPending, findOverdue } = build();
    await consumer.handle(TX, { userId });

    expect(await listPending.execute()).toEqual([{ paymentId: payment.id, refundRequestedAt: T0 }]);

    clock.set(addDuration(T0, { hours: REFUND_SLA_HOURS, milliseconds: -1 }));
    expect(await findOverdue.execute()).toEqual([]);
    clock.set(addDuration(T0, { hours: REFUND_SLA_HOURS }));
    expect(await findOverdue.execute()).toEqual([
      { paymentId: payment.id, refundRequestedAt: T0, hoursPending: REFUND_SLA_HOURS },
    ]);
  });
});

describe('RequestManualRefund (admin)', () => {
  const actor = { adminId: newId<'Admin'>(), ip: '10.0.0.1' };

  it('chuyển REFUND_PENDING, huỷ voucher, ghi audit có lý do', async () => {
    const { payment } = seedPaidUser(store, clock);
    const r = await build().manual.execute({ actor, paymentId: payment.id, reason: 'Khách khiếu nại' });
    expect(unwrap(r)).toEqual({
      paymentId: payment.id,
      status: 'REFUND_PENDING',
      refundRequestedAt: T0,
      voucherVoided: true,
    });
    expect(audit.entries).toEqual([
      {
        actor: { type: 'admin', id: actor.adminId },
        action: MANUAL_REFUND_AUDIT_ACTION,
        targetType: 'payment',
        targetId: payment.id,
        ip: '10.0.0.1',
        meta: { reason: 'Khách khiếu nại', previousStatus: 'SUCCEEDED', voucherVoided: true },
      },
    ]);
    expect(gateway.refundCalls).toHaveLength(0);
  });

  it('id sai / không tồn tại → PAYMENT_NOT_FOUND; đã hoàn → PAYMENT_ALREADY_REFUNDED; PENDING → NOT_REFUNDABLE', async () => {
    const { manual } = build();
    const code = async (paymentId: string) => {
      const r = await manual.execute({ actor, paymentId, reason: 'x' });
      return r.isErr() ? r.error.code : 'OK';
    };
    expect(await code('nope')).toBe('PAYMENT_NOT_FOUND');
    expect(await code(newId())).toBe('PAYMENT_NOT_FOUND');

    const { payment } = seedPaidUser(store, clock);
    expect(await code(payment.id)).toBe('OK');
    expect(await code(payment.id)).toBe('PAYMENT_ALREADY_REFUNDED');

    const pending = VerificationPayment.create(
      { id: newId(), orderId: 'VPpending', userId: newId(), idempotencyKey: 'k-pending' },
      clock.now(),
    );
    store.seed(pending);
    expect(await code(pending.id)).toBe('PAYMENT_NOT_REFUNDABLE');
    expect(audit.entries).toHaveLength(1);
  });

  it('audit bị từ chối → throw, rollback toàn bộ (vẫn SUCCEEDED)', async () => {
    const { payment, voucher } = seedPaidUser(store, clock);
    audit.failWith = 'AUDIT_ENTRY_INVALID';
    await expect(build().manual.execute({ actor, paymentId: payment.id, reason: 'x' })).rejects.toThrow(
      /audit log billing.refund_request rejected/,
    );
    expect(store.get(payment.id).status).toBe('SUCCEEDED');
    expect(store.vouchers.get(voucher.id)?.status).toBe('RESERVED');
    expect(store.ledger).toHaveLength(0);
  });
});

describe('mã lỗi hoàn tiền (BE-S4-04)', () => {
  it.each(BILLING_REFUND_ERRORS)('%s đã đăng ký HTTP status trong contracts', (c) => {
    expect(errorRegistry.statusOf(c)).toBe(404);
  });
});

describe('FakePaymentGateway.acceptUnknownRefunds (worker dev)', () => {
  it('bật: hoàn được giao dịch lạ đúng 1 lần; tắt (mặc định): REJECTED', async () => {
    await expect(gateway.refund('txn_from_api', 1000n)).resolves.toMatchObject({
      gatewayRefundId: expect.any(String),
    });
    await expect(gateway.refund('txn_from_api', 1000n)).rejects.toMatchObject({ kind: 'REJECTED' });
    const strict = new FakePaymentGateway({ secret: 'unit-test-secret' });
    await expect(strict.refund('txn_from_api', 1000n)).rejects.toMatchObject({ kind: 'REJECTED' });
  });
});
