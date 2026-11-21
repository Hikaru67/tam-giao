import { err, ok, type Clock, type Result, type Tx } from '@tamgiao/kernel';
import type { BillingUserId } from '../../domain/verification-payment.js';
import { startRefund, type StartRefundDeps, type StartRefundError } from './start-refund.js';

export interface RefundOnKycRejectedCommand {
  readonly userId: BillingUserId;
}

/**
 * - `REFUND_REQUESTED`: khoản `SUCCEEDED` đã chuyển `REFUND_PENDING` (job sẽ gọi cổng).
 * - `NO_REFUNDABLE_PAYMENT`: không có khoản `SUCCEEDED` (chưa trả, đang/đã hoàn — vd event lặp lại) → bỏ qua.
 */
export type RefundOnKycRejectedOutcome =
  | { readonly kind: 'REFUND_REQUESTED'; readonly paymentId: string; readonly voucherVoided: boolean }
  | { readonly kind: 'NO_REFUNDABLE_PAYMENT' };

export interface RefundOnKycRejectedDeps extends StartRefundDeps {
  readonly clock: Clock;
}

/**
 * Consumer `KycRejected` (BE-S4-04, consumer `billing.refund-on-kyc-rejected`). Chạy trong transaction của
 * `deliverOnce` (cùng `processed_events`) nên event giao lại không chạy lại; thêm lớp idempotent theo trạng thái:
 * khoá khoản `SUCCEEDED` của người dùng (`FOR UPDATE`) — không có → bỏ qua. Không gọi cổng ở đây (A9: chạy lại
 * không đổi kết quả, không giữ transaction khi chờ mạng); job quét `REFUND_PENDING` gọi cổng sau.
 */
export class RefundOnKycRejected {
  constructor(private readonly deps: RefundOnKycRejectedDeps) {}

  async handle(
    tx: Tx,
    cmd: RefundOnKycRejectedCommand,
  ): Promise<Result<RefundOnKycRejectedOutcome, StartRefundError>> {
    const payment = await this.deps.payments.findSucceededByUserForUpdate(tx, cmd.userId);
    if (payment === null) return ok({ kind: 'NO_REFUNDABLE_PAYMENT' });
    const started = await startRefund(this.deps, tx, payment, this.deps.clock.now());
    if (started.isErr()) return err(started.error);
    return ok({
      kind: 'REFUND_REQUESTED',
      paymentId: payment.id,
      voucherVoided: started.value.voucherVoided,
    });
  }
}
