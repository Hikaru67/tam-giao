import type { Money } from '@tamgiao/kernel';
import type { PaymentStatus, VerificationPaymentId } from '../../domain/verification-payment.js';
import type { CheckoutSession } from '../ports/payment-gateway.js';
import type { StoredPayment } from '../ports/payment-repositories.js';

/** Khoản thanh toán cho người dùng (lịch sử + phiên thanh toán). */
export interface PaymentView {
  readonly paymentId: VerificationPaymentId;
  readonly orderId: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
  /** Chỉ có khi còn `PENDING` (sau đó phiên không còn dùng được). */
  readonly checkout: CheckoutSession | null;
  readonly createdAt: Date;
  readonly succeededAt: Date | null;
  readonly failedAt: Date | null;
  readonly refundedAt: Date | null;
}

export const toPaymentView = ({ payment, checkout }: StoredPayment): PaymentView => {
  const s = payment.toState();
  return {
    paymentId: s.id,
    orderId: s.orderId,
    status: s.status,
    amount: s.amount,
    checkout: s.status === 'PENDING' ? checkout : null,
    createdAt: s.createdAt,
    succeededAt: s.succeededAt,
    failedAt: s.failedAt,
    refundedAt: s.refundedAt,
  };
};
