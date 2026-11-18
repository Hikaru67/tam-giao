import { DEPOSIT_VND } from '@tamgiao/contracts/constants';
import { Money, newId, type Result } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_STATUSES,
  VerificationPayment,
  type PaymentStatus,
  type VerificationPaymentId,
} from '../domain/verification-payment.js';

const T0 = new Date('2026-11-01T00:00:00.000Z');
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);
const USER_ID = newId<'User'>();

const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.isErr()) throw new Error(`expected Ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

const errCode = <T, E extends { code: string }>(result: Result<T, E>): string => {
  if (result.isOk()) throw new Error('expected Err');
  return result.error.code;
};

const pending = (): VerificationPayment =>
  VerificationPayment.create(
    {
      id: newId<'VerificationPayment'>() as VerificationPaymentId,
      orderId: 'ORD-1',
      userId: USER_ID,
      idempotencyKey: 'idem-1',
    },
    T0,
  );

/** Dựng payment ở trạng thái cho trước bằng chuỗi chuyển hợp lệ, xoá event. */
const inStatus = (status: PaymentStatus): VerificationPayment => {
  const p = pending();
  if (status === 'FAILED') unwrap(p.markFailed('CANCELLED', at(1)));
  if (status === 'SUCCEEDED' || status === 'REFUND_PENDING' || status === 'REFUNDED')
    unwrap(p.markSucceeded('TXN-1', at(1)));
  if (status === 'REFUND_PENDING' || status === 'REFUNDED') unwrap(p.requestRefund(at(2)));
  if (status === 'REFUNDED') unwrap(p.completeRefund(at(3)));
  p.pullEvents();
  return p;
};

describe('VerificationPayment.create', () => {
  it('starts PENDING with DEPOSIT_VND as Money, no gateway txn, no events', () => {
    const p = pending();
    expect(p.status).toBe('PENDING');
    expect(p.amount.equals(Money.ofTrusted(DEPOSIT_VND))).toBe(true);
    expect(typeof p.amount.amount).toBe('bigint');
    expect(p.gatewayTxnId).toBeNull();
    expect(p.idempotencyKey).toBe('idem-1');
    expect(p.orderId).toBe('ORD-1');
    expect(p.version).toBe(0);
    expect(p.pullEvents()).toEqual([]);
  });
});

describe('VerificationPayment valid transitions', () => {
  it('PENDING → SUCCEEDED assigns gatewayTxnId and records PaymentSucceeded', () => {
    const p = pending();
    unwrap(p.markSucceeded('TXN-9', at(5)));
    expect(p.status).toBe('SUCCEEDED');
    expect(p.gatewayTxnId).toBe('TXN-9');
    expect(p.toState().succeededAt).toEqual(at(5));
    const [event, ...rest] = p.pullEvents();
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      type: 'PaymentSucceeded',
      aggregateType: 'VerificationPayment',
      aggregateId: p.id,
      version: 1,
      occurredAt: at(5),
      payload: {
        paymentId: p.id,
        orderId: 'ORD-1',
        userId: USER_ID,
        amountVnd: DEPOSIT_VND,
        gatewayTxnId: 'TXN-9',
      },
    });
    expect(typeof event?.eventId).toBe('string');
  });

  it('PENDING → FAILED records PaymentFailed with reason', () => {
    const p = pending();
    unwrap(p.markFailed('USER_CANCELLED', at(5)));
    expect(p.status).toBe('FAILED');
    expect(p.gatewayTxnId).toBeNull();
    expect(p.toState()).toMatchObject({ failureReason: 'USER_CANCELLED', failedAt: at(5) });
    expect(p.pullEvents()).toMatchObject([
      {
        type: 'PaymentFailed',
        version: 1,
        payload: { paymentId: p.id, userId: USER_ID, reason: 'USER_CANCELLED' },
      },
    ]);
  });

  it('SUCCEEDED → REFUND_PENDING without event, then REFUNDED with RefundCompleted', () => {
    const p = inStatus('SUCCEEDED');
    const versionBefore = p.version;
    unwrap(p.requestRefund(at(10)));
    expect(p.status).toBe('REFUND_PENDING');
    expect(p.version).toBe(versionBefore);
    expect(p.pullEvents()).toEqual([]);

    unwrap(p.completeRefund(at(11)));
    expect(p.status).toBe('REFUNDED');
    expect(p.toState()).toMatchObject({ refundRequestedAt: at(10), refundedAt: at(11) });
    expect(p.pullEvents()).toMatchObject([
      {
        type: 'RefundCompleted',
        version: versionBefore + 1,
        payload: { paymentId: p.id, orderId: 'ORD-1', userId: USER_ID, amountVnd: DEPOSIT_VND },
      },
    ]);
  });
});

describe('VerificationPayment invalid transitions (full matrix)', () => {
  const others = (allowed: PaymentStatus[]): PaymentStatus[] =>
    PAYMENT_STATUSES.filter((s) => !allowed.includes(s));

  it.each(others(['PENDING']))('markSucceeded from %s → PAYMENT_INVALID_TRANSITION', (status) => {
    const p = inStatus(status);
    const before = p.toState();
    expect(errCode(p.markSucceeded('TXN-2', at(20)))).toBe('PAYMENT_INVALID_TRANSITION');
    expect(p.toState()).toEqual(before);
    expect(p.pullEvents()).toEqual([]);
  });

  it.each(others(['PENDING']))('markFailed from %s → PAYMENT_INVALID_TRANSITION', (status) => {
    const p = inStatus(status);
    expect(errCode(p.markFailed(null, at(20)))).toBe('PAYMENT_INVALID_TRANSITION');
    expect(p.status).toBe(status);
    expect(p.pullEvents()).toEqual([]);
  });

  // AC1: không thể refund payment chưa SUCCEEDED hoặc refund 2 lần.
  it.each<[PaymentStatus, string]>([
    ['PENDING', 'PAYMENT_NOT_REFUNDABLE'],
    ['FAILED', 'PAYMENT_NOT_REFUNDABLE'],
    ['REFUND_PENDING', 'PAYMENT_ALREADY_REFUNDED'],
    ['REFUNDED', 'PAYMENT_ALREADY_REFUNDED'],
  ])('requestRefund from %s → %s', (status, code) => {
    const p = inStatus(status);
    expect(errCode(p.requestRefund(at(20)))).toBe(code);
    expect(p.status).toBe(status);
    expect(p.pullEvents()).toEqual([]);
  });

  it.each<[PaymentStatus, string]>([
    ['PENDING', 'PAYMENT_NOT_REFUNDABLE'],
    ['FAILED', 'PAYMENT_NOT_REFUNDABLE'],
    ['SUCCEEDED', 'PAYMENT_INVALID_TRANSITION'],
    ['REFUNDED', 'PAYMENT_ALREADY_REFUNDED'],
  ])('completeRefund from %s → %s', (status, code) => {
    const p = inStatus(status);
    expect(errCode(p.completeRefund(at(20)))).toBe(code);
    expect(p.status).toBe(status);
    expect(p.pullEvents()).toEqual([]);
  });

  it('refunding twice end-to-end fails the second time and emits RefundCompleted once', () => {
    const p = inStatus('SUCCEEDED');
    unwrap(p.requestRefund(at(1)));
    unwrap(p.completeRefund(at(2)));
    expect(errCode(p.requestRefund(at(3)))).toBe('PAYMENT_ALREADY_REFUNDED');
    expect(errCode(p.completeRefund(at(3)))).toBe('PAYMENT_ALREADY_REFUNDED');
    expect(p.pullEvents().filter((e) => e.type === 'RefundCompleted')).toHaveLength(1);
  });
});

describe('VerificationPayment persistence round-trip', () => {
  it('restore(toState()) keeps state and version', () => {
    const p = inStatus('REFUND_PENDING');
    const restored = VerificationPayment.restore(p.toState());
    expect(restored.toState()).toEqual(p.toState());
    expect(restored.version).toBe(p.version);
    unwrap(restored.completeRefund(at(30)));
    expect(restored.pullEvents()[0]?.version).toBe(p.version + 1);
  });
});
