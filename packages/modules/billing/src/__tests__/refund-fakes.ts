import type { FakeClock } from '@tamgiao/kernel';
import { newId, type Tx } from '@tamgiao/kernel';
import type {
  RefundPaymentRepository,
  RefundVoucherRepository,
} from '../application/ports/refund-repositories.js';
import { VerificationPayment, type VerificationPaymentId } from '../domain/verification-payment.js';
import { Voucher } from '../domain/voucher.js';
import type { InMemoryBillingStore } from './payment-fakes.js';

/** Repository in-memory cho luồng hoàn tiền, dùng chung kho `InMemoryBillingStore` với test thanh toán. */
export function refundPaymentRepo(store: InMemoryBillingStore): RefundPaymentRepository {
  const all = () => [...store.payments.values()].map((r) => r.state);
  const restore = (id: string) => {
    const row = store.payments.get(id);
    return row ? VerificationPayment.restore(row.state) : null;
  };
  return {
    findSucceededByUserForUpdate: async (_tx, userId) => {
      const s = all().find((p) => p.userId === userId && p.status === 'SUCCEEDED');
      return s ? VerificationPayment.restore(s) : null;
    },
    findByIdForUpdate: async (_tx, id) => restore(id),
    findById: async (_tx, id) => restore(id),
    listRefundPending: async (_tx, { limit, requestedAtOrBefore }) =>
      all()
        .filter(
          (p) =>
            p.status === 'REFUND_PENDING' &&
            p.refundRequestedAt !== null &&
            (requestedAtOrBefore === undefined ||
              p.refundRequestedAt.getTime() <= requestedAtOrBefore.getTime()),
        )
        .sort((a, b) => (a.refundRequestedAt?.getTime() ?? 0) - (b.refundRequestedAt?.getTime() ?? 0))
        .slice(0, limit)
        .map((p) => ({ paymentId: p.id, refundRequestedAt: p.refundRequestedAt ?? new Date(0) })),
    save: (tx: Tx, payment) => store.paymentRepo.save(tx, payment),
  };
}

export function refundVoucherRepo(store: InMemoryBillingStore): RefundVoucherRepository {
  return {
    findByPaymentIdForUpdate: async (_tx, paymentId) => {
      const s = [...store.vouchers.values()].find((v) => v.paymentId === paymentId);
      return s ? Voucher.restore(s) : null;
    },
    listOpenByUserForUpdate: async (_tx, userId) =>
      [...store.vouchers.values()]
        .filter((v) => v.userId === userId && (v.status === 'RESERVED' || v.status === 'ACTIVE'))
        .map((s) => Voucher.restore(s)),
    save: async (_tx, voucher) => {
      const s = voucher.toState();
      if (!store.vouchers.has(s.id)) throw new Error('voucher not found');
      store.vouchers.set(s.id, s);
      store.events.push(...voucher.pullEvents());
    },
  };
}

/** Seed một khoản `SUCCEEDED` (gatewayTxnId cho trước) + voucher `RESERVED` như sau webhook thành công. */
export function seedPaidUser(
  store: InMemoryBillingStore,
  clock: FakeClock,
  options: { readonly userId?: string; readonly gatewayTxnId?: string } = {},
): { readonly userId: string; readonly payment: VerificationPayment; readonly voucher: Voucher } {
  const userId = options.userId ?? newId<'User'>();
  const payment = VerificationPayment.create(
    {
      id: newId<'VerificationPayment'>() as VerificationPaymentId,
      orderId: `VP${newId().replaceAll('-', '')}`,
      userId,
      idempotencyKey: `key-${newId()}`,
    },
    clock.now(),
  );
  payment.markSucceeded(options.gatewayTxnId ?? `txn_${newId()}`, clock.now());
  store.seed(payment);
  const voucher = Voucher.issue({ id: newId<'Voucher'>(), userId, paymentId: payment.id }, clock.now());
  voucher.pullEvents();
  store.vouchers.set(voucher.id, voucher.toState());
  return { userId, payment, voucher };
}
