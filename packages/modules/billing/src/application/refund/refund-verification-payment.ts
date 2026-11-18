import {
  err,
  newId,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import { LedgerEntry } from '../../domain/ledger-entry.js';
import type { PaymentStatus, VerificationPaymentId } from '../../domain/verification-payment.js';
import {
  PaymentGatewayError,
  type PaymentGateway,
  type PaymentGatewayErrorKind,
} from '../ports/payment-gateway.js';
import type { LedgerRepository } from '../ports/payment-repositories.js';
import type { RefundPaymentRepository } from '../ports/refund-repositories.js';

export interface RefundVerificationPaymentCommand {
  readonly paymentId: string;
}

/**
 * Kết quả một lần chạy job hoàn tiền:
 * - `REFUNDED`: cổng đã hoàn, payment `REFUNDED` + ledger `REFUND` + event `RefundCompleted`.
 * - `SKIPPED`: không còn gì để làm (không tồn tại / không ở `REFUND_PENDING`, vd đã hoàn ở lần chạy trước).
 * - `GATEWAY_REJECTED`: cổng từ chối **vĩnh viễn** (`retryable = false`) — giữ `REFUND_PENDING` cho vận hành;
 *   người gọi phải log mức error.
 * Lỗi **tạm thời** của cổng (`PaymentGatewayError.retryable`) được **throw** để hàng đợi retry backoff.
 */
export type RefundVerificationPaymentOutcome =
  | { readonly kind: 'REFUNDED'; readonly paymentId: string }
  | { readonly kind: 'SKIPPED'; readonly paymentId: string; readonly status: PaymentStatus | null }
  | {
      readonly kind: 'GATEWAY_REJECTED';
      readonly paymentId: string;
      readonly gatewayErrorKind: PaymentGatewayErrorKind;
    };

export interface RefundVerificationPaymentDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly gateway: PaymentGateway;
  readonly payments: RefundPaymentRepository;
  readonly ledger: LedgerRepository;
}

/**
 * Bước 2 của hoàn tiền (job, BE-S4-04): gọi `gateway.refund` **ngoài transaction** rồi ghi kết quả.
 * 1. Transaction ngắn đọc payment — không ở `REFUND_PENDING` → `SKIPPED` (idempotent, không gọi cổng).
 * 2. Gọi cổng (không giữ connection/khoá khi chờ mạng).
 * 3. Transaction: khoá payment (`FOR UPDATE`), kiểm tra lại `REFUND_PENDING` → `completeRefund` + ledger `REFUND`
 *    (unique (payment, `REFUND`) chặn ghi trùng ở DB) + `RefundCompleted` qua outbox.
 * Mỗi payment chỉ có một job (id job xác định theo payment) nên không có hai lần gọi cổng song song.
 */
export class RefundVerificationPayment {
  constructor(private readonly deps: RefundVerificationPaymentDeps) {}

  async execute(
    cmd: RefundVerificationPaymentCommand,
  ): Promise<Result<RefundVerificationPaymentOutcome, DomainError>> {
    const parsed = parseId<'VerificationPayment'>(cmd.paymentId);
    if (parsed.isErr()) return ok({ kind: 'SKIPPED', paymentId: cmd.paymentId, status: null });
    const paymentId: VerificationPaymentId = parsed.value;

    const loaded = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.payments.findById(tx, paymentId)),
    );
    if (loaded.isErr()) return err(loaded.error);
    const current = loaded.value;
    if (current === null || current.status !== 'REFUND_PENDING' || current.gatewayTxnId === null) {
      return ok({ kind: 'SKIPPED', paymentId, status: current?.status ?? null });
    }

    try {
      await this.deps.gateway.refund(current.gatewayTxnId, current.amount.amount);
    } catch (error) {
      if (error instanceof PaymentGatewayError && !error.retryable) {
        return ok({ kind: 'GATEWAY_REJECTED', paymentId, gatewayErrorKind: error.kind });
      }
      throw error;
    }

    return this.deps.uow.run(async (tx): Promise<Result<RefundVerificationPaymentOutcome, DomainError>> => {
      const payment = await this.deps.payments.findByIdForUpdate(tx, paymentId);
      if (payment === null || payment.status !== 'REFUND_PENDING') {
        return ok<RefundVerificationPaymentOutcome>({
          kind: 'SKIPPED',
          paymentId,
          status: payment?.status ?? null,
        });
      }
      const now = this.deps.clock.now();
      const completed = payment.completeRefund(now);
      if (completed.isErr()) return err(completed.error);
      const entry = LedgerEntry.create({
        id: newId<'LedgerEntry'>(),
        type: 'REFUND',
        amount: payment.amount,
        userId: payment.userId,
        paymentId: payment.id,
        voucherId: null,
        occurredAt: now,
      });
      if (entry.isErr()) return err(entry.error);
      await this.deps.payments.save(tx, payment);
      await this.deps.ledger.append(tx, [entry.value]);
      return ok<RefundVerificationPaymentOutcome>({ kind: 'REFUNDED', paymentId });
    });
  }
}
