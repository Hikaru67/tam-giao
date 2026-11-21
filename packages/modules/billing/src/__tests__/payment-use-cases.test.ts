import { VERIFICATION_PAYMENT_STATUSES } from '@tamgiao/contracts';
import { DEPOSIT_VND, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { FakeClock, newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CreateVerificationCheckout,
  orderIdFor,
} from '../application/payment/create-verification-checkout.js';
import {
  GATEWAY_FAILED_REASON,
  HandlePaymentWebhook,
} from '../application/payment/handle-payment-webhook.js';
import { BillingFacadeQueries, GetMyPayments } from '../application/payment/payment-queries.js';
import { PaymentGatewayError, type PaymentGateway } from '../application/ports/payment-gateway.js';
import { PAYMENT_STATUSES, VerificationPayment } from '../domain/verification-payment.js';
import { FAKE_SIGNATURE_HEADER, FakePaymentGateway } from '../infrastructure/gateway/fake-payment-gateway.js';
import { FakeBillingUnitOfWork, InMemoryBillingStore } from './payment-fakes.js';

const T0 = new Date('2026-11-18T03:00:00.000Z');
const RETURN_URL = 'tamgiao://payments/return';
const KEY_1 = 'idem-key-0001';
const KEY_2 = 'idem-key-0002';

let clock: FakeClock;
let store: InMemoryBillingStore;
let uow: FakeBillingUnitOfWork;
let gateway: FakePaymentGateway;
const user = newId<'User'>();

const checkoutUseCase = (gw: PaymentGateway = gateway) =>
  new CreateVerificationCheckout({
    uow,
    clock,
    payments: store.paymentRepo,
    gateway: gw,
    returnUrl: RETURN_URL,
  });
const webhookUseCase = () =>
  new HandlePaymentWebhook({
    uow,
    clock,
    gateway,
    payments: store.paymentRepo,
    vouchers: store.voucherRepo,
    ledger: store.ledgerRepo,
  });
const facade = () => new BillingFacadeQueries({ uow, payments: store.paymentRepo });

async function checkout(key = KEY_1, userId = user) {
  const r = await checkoutUseCase().execute({ userId, idempotencyKey: key });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
}

/** Thêm thẳng một khoản ở trạng thái cho trước. */
function seedPayment(status: 'SUCCEEDED' | 'REFUND_PENDING' | 'REFUNDED' | 'FAILED', key = 'seed-key-01') {
  const id = newId<'VerificationPayment'>();
  const p = VerificationPayment.create(
    { id, orderId: orderIdFor(id), userId: user, idempotencyKey: key },
    T0,
  );
  if (status === 'FAILED') p.markFailed('X', T0);
  else {
    p.markSucceeded(`txn-${id}`, T0);
    if (status !== 'SUCCEEDED') p.requestRefund(T0);
    if (status === 'REFUNDED') p.completeRefund(T0);
  }
  store.seed(p);
  return p;
}

beforeEach(() => {
  clock = new FakeClock(T0);
  store = new InMemoryBillingStore();
  uow = new FakeBillingUnitOfWork(store);
  gateway = new FakePaymentGateway({ secret: 'unit-test-webhook-secret', clock });
});

describe('CreateVerificationCheckout', () => {
  it('creates a PENDING payment of DEPOSIT_VND and stores the gateway checkout', async () => {
    const v = await checkout();

    expect(v.created).toBe(true);
    expect(v.status).toBe('PENDING');
    expect(v.amount.amount).toBe(BigInt(DEPOSIT_VND));
    expect(v.orderId).toBe(orderIdFor(v.paymentId));
    expect(v.checkout.checkoutUrl).toContain(encodeURIComponent(v.orderId));
    expect(v.checkout.qrData).toBe(`FAKEPAY|${v.orderId}|${DEPOSIT_VND}`);
    expect(store.payments.get(v.paymentId)?.checkout).toEqual(v.checkout);
    expect(store.events).toHaveLength(0);
  });

  it('same idempotency key → returns exactly the previous checkout, no new payment', async () => {
    const first = await checkout();
    clock.advance({ minutes: 5 });
    const again = await checkout();

    expect(again).toEqual({ ...first, created: false });
    expect(store.payments.size).toBe(1);
  });

  it('another key while a PENDING payment exists → returns that pending payment (no second order)', async () => {
    const first = await checkout(KEY_1);
    const other = await checkout(KEY_2);

    expect(other.paymentId).toBe(first.paymentId);
    expect(other.created).toBe(false);
    expect(store.payments.size).toBe(1);
  });

  it.each(['SUCCEEDED', 'REFUND_PENDING', 'REFUNDED'] as const)(
    'already %s → PAYMENT_ALREADY_EXISTS',
    async (status) => {
      seedPayment(status);
      const r = await checkoutUseCase().execute({ userId: user, idempotencyKey: KEY_1 });
      expect(r.isErr() && r.error).toEqual({ code: 'PAYMENT_ALREADY_EXISTS', details: { status } });
      expect(store.payments.size).toBe(1);
    },
  );

  it('previous payment FAILED → a new key creates a new payment', async () => {
    seedPayment('FAILED');
    const v = await checkout(KEY_2);
    expect(v.created).toBe(true);
    expect(store.payments.size).toBe(2);
  });

  it('insert loses a race (unique conflict) → rolls back and returns the winner idempotently', async () => {
    let winnerId = '';
    store.beforeInsert = () => {
      store.beforeInsert = null;
      const id = newId<'VerificationPayment'>();
      winnerId = id;
      store.seedCommitted(
        VerificationPayment.create({ id, orderId: orderIdFor(id), userId: user, idempotencyKey: KEY_2 }, T0),
        { checkoutUrl: 'https://gw/winner', qrData: 'QR-WINNER' },
      );
    };
    const v = await checkout(KEY_1);

    expect(v.paymentId).toBe(winnerId);
    expect(v.created).toBe(false);
    expect(v.checkout).toEqual({ checkoutUrl: 'https://gw/winner', qrData: 'QR-WINNER' });
    expect(store.payments.size).toBe(1);
    expect(uow.runs).toBe(2);
  });

  it('gateway failure → PAYMENT_GATEWAY_UNAVAILABLE; payment stays PENDING and the next call creates the checkout', async () => {
    const failing: PaymentGateway = {
      createCheckout: async () => {
        throw new PaymentGatewayError('TIMEOUT', 'createCheckout');
      },
      verifyWebhook: (h, b) => gateway.verifyWebhook(h, b),
      refund: (t, a) => gateway.refund(t, a),
    };
    const r = await checkoutUseCase(failing).execute({ userId: user, idempotencyKey: KEY_1 });
    expect(r.isErr() && r.error).toEqual({
      code: 'PAYMENT_GATEWAY_UNAVAILABLE',
      details: { kind: 'TIMEOUT' },
    });
    const [row] = [...store.payments.values()];
    expect(row?.state.status).toBe('PENDING');
    expect(row?.checkout).toBeNull();

    const retry = await checkout(KEY_1);
    expect(retry.paymentId).toBe(row?.state.id);
    expect(retry.created).toBe(false);
    expect(store.payments.get(retry.paymentId)?.checkout).toEqual(retry.checkout);
  });

  it('a non-gateway error from the gateway is a programming error → thrown', async () => {
    const broken: PaymentGateway = {
      createCheckout: async () => {
        throw new Error('boom');
      },
      verifyWebhook: (h, b) => gateway.verifyWebhook(h, b),
      refund: (t, a) => gateway.refund(t, a),
    };
    await expect(checkoutUseCase(broken).execute({ userId: user, idempotencyKey: KEY_1 })).rejects.toThrow(
      'boom',
    );
  });
});

describe('HandlePaymentWebhook', () => {
  it('invalid signature → WEBHOOK_INVALID, no transaction, nothing written', async () => {
    const v = await checkout();
    const hook = gateway.simulatePayment(v.orderId, 'SUCCEEDED');
    const runs = uow.runs;
    const r = await webhookUseCase().execute({
      headers: { ...hook.headers, [FAKE_SIGNATURE_HEADER]: '00'.repeat(32) },
      rawBody: hook.rawBody,
    });

    expect(r.isErr() && r.error.code).toBe('WEBHOOK_INVALID');
    expect(uow.runs).toBe(runs);
    expect(store.get(v.paymentId).status).toBe('PENDING');
    expect(store.ledger).toHaveLength(0);
  });

  it('SUCCEEDED → payment SUCCEEDED, CHARGE + VOUCHER_ISSUE ledger, RESERVED voucher, events via outbox', async () => {
    const v = await checkout();
    clock.advance({ minutes: 3 });
    const hook = gateway.simulatePayment(v.orderId, 'SUCCEEDED');
    const txnId = (JSON.parse(hook.rawBody) as { gatewayTxnId: string }).gatewayTxnId;
    const r = await webhookUseCase().execute(hook);

    expect(r.isOk() && r.value).toEqual({
      outcome: 'SUCCEEDED',
      orderId: v.orderId,
      gatewayTxnId: txnId,
      paymentId: v.paymentId,
      paymentStatus: 'PENDING',
    });
    const p = store.get(v.paymentId);
    expect(p).toMatchObject({ status: 'SUCCEEDED', gatewayTxnId: txnId, succeededAt: clock.now() });

    const [voucher] = [...store.vouchers.values()];
    expect(voucher).toMatchObject({
      userId: user,
      paymentId: v.paymentId,
      status: 'RESERVED',
      expiresAt: null,
      partnerId: null,
    });
    expect(voucher?.value.amount).toBe(BigInt(VOUCHER_VND));

    expect(store.ledger.map((e) => [e.type, e.amount.amount, e.paymentId, e.voucherId])).toEqual([
      ['CHARGE', BigInt(DEPOSIT_VND), v.paymentId, null],
      ['VOUCHER_ISSUE', BigInt(VOUCHER_VND), v.paymentId, voucher?.id],
    ]);
    expect(store.events.map((e) => e.type)).toEqual(['PaymentSucceeded', 'VoucherIssued']);
    expect(await facade().hasPaidVerification(user)).toBe(true);
  });

  it('the same webhook delivered 3 times → only one ledger set and one voucher (AC1)', async () => {
    const v = await checkout();
    const hook = gateway.simulatePayment(v.orderId, 'SUCCEEDED');
    const outcomes = [];
    for (let i = 0; i < 3; i++) {
      const r = await webhookUseCase().execute(hook);
      outcomes.push(r.isOk() && r.value.outcome);
    }

    expect(outcomes).toEqual(['SUCCEEDED', 'DUPLICATE', 'DUPLICATE']);
    expect(store.ledger).toHaveLength(2);
    expect(store.vouchers.size).toBe(1);
    expect(store.events).toHaveLength(2);
  });

  it('a second SUCCEEDED webhook with another transaction id → IGNORED, nothing written', async () => {
    const v = await checkout();
    await webhookUseCase().execute(gateway.simulatePayment(v.orderId, 'SUCCEEDED'));
    const r = await webhookUseCase().execute(gateway.simulatePayment(v.orderId, 'SUCCEEDED'));

    expect(r.isOk() && r.value.outcome).toBe('IGNORED');
    expect(store.ledger).toHaveLength(2);
    expect(store.vouchers.size).toBe(1);
  });

  it('FAILED → payment FAILED with PaymentFailed; repeated → DUPLICATE; later SUCCEEDED → IGNORED', async () => {
    const v = await checkout();
    const failed = gateway.simulatePayment(v.orderId, 'FAILED');
    const first = await webhookUseCase().execute(failed);
    const again = await webhookUseCase().execute(failed);
    const late = await webhookUseCase().execute(gateway.simulatePayment(v.orderId, 'SUCCEEDED'));

    expect([first, again, late].map((r) => r.isOk() && r.value.outcome)).toEqual([
      'FAILED',
      'DUPLICATE',
      'IGNORED',
    ]);
    expect(store.get(v.paymentId)).toMatchObject({ status: 'FAILED', failureReason: GATEWAY_FAILED_REASON });
    expect(store.events.map((e) => e.type)).toEqual(['PaymentFailed']);
    expect(store.ledger).toHaveLength(0);
    expect(await facade().hasPaidVerification(user)).toBe(false);
  });

  it('FAILED webhook after SUCCEEDED → IGNORED, payment stays SUCCEEDED', async () => {
    const v = await checkout();
    await webhookUseCase().execute(gateway.simulatePayment(v.orderId, 'SUCCEEDED'));
    const r = await webhookUseCase().execute(gateway.simulatePayment(v.orderId, 'FAILED'));
    expect(r.isOk() && r.value.outcome).toBe('IGNORED');
    expect(store.get(v.paymentId).status).toBe('SUCCEEDED');
  });

  it('amount differs from the payment → AMOUNT_MISMATCH, payment stays PENDING, nothing written', async () => {
    const v = await checkout();
    // Cổng báo số tiền khác: mô phỏng bằng một đơn giả cùng mã trên cổng với số tiền khác.
    await gateway.createCheckout(v.orderId, 1_000n, RETURN_URL);
    const r = await webhookUseCase().execute(gateway.simulatePayment(v.orderId, 'SUCCEEDED'));

    expect(r.isOk() && r.value.outcome).toBe('AMOUNT_MISMATCH');
    expect(store.get(v.paymentId).status).toBe('PENDING');
    expect(store.ledger).toHaveLength(0);
    expect(store.vouchers.size).toBe(0);
    expect(store.events).toHaveLength(0);
  });

  it('unknown order → UNKNOWN_ORDER, nothing written', async () => {
    await gateway.createCheckout('VPUNKNOWN', BigInt(DEPOSIT_VND), RETURN_URL);
    const r = await webhookUseCase().execute(gateway.simulatePayment('VPUNKNOWN', 'SUCCEEDED'));
    expect(r.isOk() && r.value).toMatchObject({
      outcome: 'UNKNOWN_ORDER',
      paymentId: null,
      paymentStatus: null,
    });
    expect(store.payments.size).toBe(0);
  });
});

describe('GetMyPayments + BillingFacade', () => {
  it('lists payments newest first; checkout only while PENDING', async () => {
    seedPayment('FAILED');
    clock.advance({ minutes: 1 });
    const v = await checkout();
    const items = await new GetMyPayments({ uow, payments: store.paymentRepo }).execute(user);

    expect(items.map((p) => p.status)).toEqual(['PENDING', 'FAILED']);
    expect(items[0]?.checkout).toEqual(v.checkout);
    expect(items[1]?.checkout).toBeNull();
    expect(await new GetMyPayments({ uow, payments: store.paymentRepo }).execute(newId())).toEqual([]);
  });

  it.each([
    ['SUCCEEDED', true],
    ['REFUND_PENDING', false],
    ['REFUNDED', false],
    ['FAILED', false],
  ] as const)('hasPaidVerification with a %s payment → %s', async (status, paid) => {
    seedPayment(status);
    expect(await facade().hasPaidVerification(user)).toBe(paid);
  });

  it('no payment / PENDING payment → not paid', async () => {
    expect(await facade().hasPaidVerification(user)).toBe(false);
    await checkout();
    expect(await facade().hasPaidVerification(user)).toBe(false);
  });
});

describe('contract', () => {
  it('payment statuses match the published DTO', () => {
    expect(PAYMENT_STATUSES).toEqual(VERIFICATION_PAYMENT_STATUSES);
  });
});
