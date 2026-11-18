import { err, fail, newId, ok, type Result, type Tx } from '@tamgiao/kernel';
import { LedgerEntry, type LedgerEntryError } from '../../domain/ledger-entry.js';
import type { PaymentRefundError, VerificationPayment } from '../../domain/verification-payment.js';
import type { VoucherTransitionError } from '../../domain/voucher.js';
import type { LedgerRepository } from '../ports/payment-repositories.js';
import type { RefundPaymentRepository, RefundVoucherRepository } from '../ports/refund-repositories.js';

/** Mã lý do huỷ voucher khi hoàn tiền khoản thanh toán sinh ra nó (không PII). */
export const REFUND_VOUCHER_VOID_REASON = 'PAYMENT_REFUNDED';

export type StartRefundError = PaymentRefundError | VoucherTransitionError | LedgerEntryError;

export interface StartRefundDeps {
  readonly payments: RefundPaymentRepository;
  readonly vouchers: RefundVoucherRepository;
  readonly ledger: LedgerRepository;
}

export interface StartRefundOutcome {
  /** `true` nếu voucher còn hiệu lực bị huỷ trong lần này. */
  readonly voucherVoided: boolean;
}

/**
 * Bước 1 của hoàn tiền, chạy **trong transaction của người gọi**, payment đã được khoá (`FOR UPDATE`):
 * payment `SUCCEEDED → REFUND_PENDING`; voucher còn hiệu lực (`RESERVED | ACTIVE`) → `VOID('PAYMENT_REFUNDED')` +
 * ledger `VOUCHER_VOID`. Voucher đã `VOID`/`EXPIRED` → giữ nguyên. Voucher đã `REDEEMED` (đã dùng tại quán) →
 * `VOUCHER_ALREADY_REDEEMED`, không đổi gì — không tự quyết hoàn tiền khi giá trị voucher đã bị tiêu.
 * **Không gọi cổng thanh toán** — job `RefundVerificationPayment` làm việc đó ngoài transaction.
 * `Err` → người gọi phải rollback (chưa ghi gì nhưng aggregate trong bộ nhớ đã đổi).
 */
export async function startRefund(
  deps: StartRefundDeps,
  tx: Tx,
  payment: VerificationPayment,
  now: Date,
): Promise<Result<StartRefundOutcome, StartRefundError>> {
  const requested = payment.requestRefund(now);
  if (requested.isErr()) return err(requested.error);

  const voucher = await deps.vouchers.findByPaymentIdForUpdate(tx, payment.id);
  if (voucher !== null && voucher.status === 'REDEEMED') {
    return fail('VOUCHER_ALREADY_REDEEMED', { status: voucher.status });
  }

  let voidEntry: LedgerEntry | null = null;
  if (voucher !== null && voucher.isOpen) {
    const voided = voucher.void(REFUND_VOUCHER_VOID_REASON, now);
    if (voided.isErr()) return err(voided.error);
    const entry = LedgerEntry.create({
      id: newId<'LedgerEntry'>(),
      type: 'VOUCHER_VOID',
      amount: voucher.value,
      userId: voucher.userId,
      paymentId: payment.id,
      voucherId: voucher.id,
      occurredAt: now,
    });
    if (entry.isErr()) return err(entry.error);
    voidEntry = entry.value;
  }

  await deps.payments.save(tx, payment);
  if (voidEntry !== null && voucher !== null) {
    await deps.vouchers.save(tx, voucher);
    await deps.ledger.append(tx, [voidEntry]);
  }
  return ok({ voucherVoided: voidEntry !== null });
}
