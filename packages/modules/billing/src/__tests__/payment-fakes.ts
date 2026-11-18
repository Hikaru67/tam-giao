import type { DomainEvent, Result, Tx, UnitOfWork } from '@tamgiao/kernel';
import type { CheckoutSession } from '../application/ports/payment-gateway.js';
import type {
  LedgerRepository,
  StoredPayment,
  VerificationPaymentRepository,
  VoucherRepository,
} from '../application/ports/payment-repositories.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import {
  VerificationPayment,
  type VerificationPaymentId,
  type VerificationPaymentState,
} from '../domain/verification-payment.js';
import type { Voucher, VoucherState } from '../domain/voucher.js';

interface PaymentRow {
  readonly state: VerificationPaymentState;
  readonly checkout: CheckoutSession | null;
}

/**
 * Kho in-memory cho thanh toán / voucher / ledger + outbox, mô phỏng các ràng buộc unique của DB
 * (`(user_id, idempotency_key)`, 1 khoản `PENDING | SUCCEEDED` mỗi người dùng, `gateway_txn_id`, `vouchers.payment_id`).
 */
export class InMemoryBillingStore {
  payments = new Map<string, PaymentRow>();
  vouchers = new Map<string, VoucherState>();
  ledger: LedgerEntry[] = [];
  events: DomainEvent[] = [];
  /** Gọi ngay trước khi insert (mô phỏng request đồng thời vừa commit một khoản). */
  beforeInsert: (() => void) | null = null;

  snapshot() {
    return {
      payments: new Map(this.payments),
      vouchers: new Map(this.vouchers),
      ledger: [...this.ledger],
      events: [...this.events],
    };
  }

  restore(s: ReturnType<InMemoryBillingStore['snapshot']>): void {
    // Khoản do "transaction khác" commit (seedCommitted) không bị rollback theo transaction hiện tại.
    for (const id of this.committedElsewhere) {
      const row = this.payments.get(id);
      if (row) s.payments.set(id, row);
    }
    this.payments = s.payments;
    this.vouchers = s.vouchers;
    this.ledger = s.ledger;
    this.events = s.events;
  }

  private readonly committedElsewhere = new Set<string>();

  /** Mô phỏng một request đồng thời đã commit khoản của nó (không bị rollback cùng transaction đang chạy). */
  seedCommitted(payment: VerificationPayment, checkout: CheckoutSession | null = null): void {
    this.committedElsewhere.add(payment.id);
    this.seed(payment, checkout);
  }

  /** Thêm thẳng một khoản (seed test). */
  seed(payment: VerificationPayment, checkout: CheckoutSession | null = null): void {
    this.payments.set(payment.id, { state: payment.toState(), checkout });
    payment.pullEvents();
  }

  get(id: string): VerificationPaymentState {
    const row = this.payments.get(id);
    if (!row) throw new Error(`payment ${id} not found`);
    return row.state;
  }

  private toStored = (row: PaymentRow): StoredPayment => ({
    payment: VerificationPayment.restore(row.state),
    checkout: row.checkout,
  });

  readonly paymentRepo: VerificationPaymentRepository = {
    findByUserAndIdempotencyKey: async (_tx, userId, key) => {
      const row = [...this.payments.values()].find(
        (r) => r.state.userId === userId && r.state.idempotencyKey === key,
      );
      return row ? this.toStored(row) : null;
    },
    listByUser: async (_tx, userId) =>
      [...this.payments.values()]
        .filter((r) => r.state.userId === userId)
        .sort((a, b) => b.state.createdAt.getTime() - a.state.createdAt.getTime())
        .map(this.toStored),
    findByOrderIdForUpdate: async (_tx, orderId) => {
      const row = [...this.payments.values()].find((r) => r.state.orderId === orderId);
      return row ? VerificationPayment.restore(row.state) : null;
    },
    insert: async (_tx, payment) => {
      this.beforeInsert?.();
      const s = payment.toState();
      const rows = [...this.payments.values()];
      const conflict = rows.some(
        (r) =>
          r.state.userId === s.userId &&
          (r.state.idempotencyKey === s.idempotencyKey || ['PENDING', 'SUCCEEDED'].includes(r.state.status)),
      );
      if (conflict) return 'conflict';
      this.payments.set(s.id, { state: s, checkout: null });
      this.events.push(...payment.pullEvents());
      return 'inserted';
    },
    save: async (_tx, payment) => {
      const s = payment.toState();
      const row = this.payments.get(s.id);
      if (!row) throw new Error('payment not found');
      if (
        s.gatewayTxnId !== null &&
        [...this.payments.values()].some(
          (r) => r.state.id !== s.id && r.state.gatewayTxnId === s.gatewayTxnId,
        )
      ) {
        throw new Error('unique violation: gateway_txn_id');
      }
      this.payments.set(s.id, { state: s, checkout: row.checkout });
      this.events.push(...payment.pullEvents());
    },
    attachCheckout: async (_tx, paymentId: VerificationPaymentId, session) => {
      const row = this.payments.get(paymentId);
      if (!row) throw new Error('payment not found');
      if (row.checkout !== null) return row.checkout;
      this.payments.set(paymentId, { ...row, checkout: session });
      return session;
    },
  };

  readonly voucherRepo: VoucherRepository = {
    insert: async (_tx, voucher: Voucher) => {
      const s = voucher.toState();
      if ([...this.vouchers.values()].some((v) => v.paymentId === s.paymentId)) {
        throw new Error('unique violation: vouchers.payment_id');
      }
      this.vouchers.set(s.id, s);
      this.events.push(...voucher.pullEvents());
    },
  };

  readonly ledgerRepo: LedgerRepository = {
    append: async (_tx, entries) => {
      this.ledger.push(...entries);
    },
  };
}

/** `Err`/throw → khôi phục kho (mô phỏng rollback). */
export class FakeBillingUnitOfWork implements UnitOfWork {
  runs = 0;
  constructor(private readonly store: InMemoryBillingStore) {}
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    this.runs++;
    const snapshot = this.store.snapshot();
    try {
      const r = await work({} as Tx);
      if (r.isErr()) this.store.restore(snapshot);
      return r;
    } catch (e) {
      this.store.restore(snapshot);
      throw e;
    }
  }
}
