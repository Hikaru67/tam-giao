import {
  err,
  fail,
  newId,
  ok,
  type Clock,
  type DomainError,
  type Result,
  type Tx,
  type UnitOfWork,
} from '@tamgiao/kernel';
import { LedgerEntry } from '../../domain/ledger-entry.js';
import type { VerificationPayment } from '../../domain/verification-payment.js';
import { Voucher } from '../../domain/voucher.js';
import {
  WEBHOOK_INVALID,
  type PaymentGateway,
  type WebhookEvent,
  type WebhookHeaders,
} from '../ports/payment-gateway.js';
import type {
  LedgerRepository,
  VerificationPaymentRepository,
  VoucherRepository,
} from '../ports/payment-repositories.js';

/**
 * Kết quả xử lý một webhook đã xác thực chữ ký (luôn phản hồi 2xx để cổng không gửi lại):
 * - `SUCCEEDED` / `FAILED`: đã ghi nhận chuyển trạng thái.
 * - `DUPLICATE`: webhook lặp lại của giao dịch đã xử lý — không ghi gì thêm.
 * - `UNKNOWN_ORDER`: không có đơn tương ứng (vd đơn của môi trường khác dùng chung tài khoản cổng).
 * - `AMOUNT_MISMATCH`: số tiền khác khoản thanh toán — không ghi nhận, cần vận hành kiểm tra.
 * - `IGNORED`: trạng thái hiện tại không cho phép chuyển (vd đơn đã thất bại mà cổng báo thành công, hoặc đã thành
 *   công với giao dịch khác) — cần vận hành kiểm tra.
 */
export type WebhookOutcome =
  'SUCCEEDED' | 'FAILED' | 'DUPLICATE' | 'UNKNOWN_ORDER' | 'AMOUNT_MISMATCH' | 'IGNORED';

export interface WebhookResult {
  readonly outcome: WebhookOutcome;
  readonly orderId: string;
  readonly gatewayTxnId: string;
  readonly paymentId: string | null;
  /** Trạng thái khoản thanh toán trước khi xử lý (để log), `null` khi không có đơn. */
  readonly paymentStatus: string | null;
}

export interface HandlePaymentWebhookCommand {
  readonly headers: WebhookHeaders;
  /** Body nguyên văn — chữ ký tính trên đúng các byte này. */
  readonly rawBody: string;
}

export interface HandlePaymentWebhookDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly gateway: PaymentGateway;
  readonly payments: VerificationPaymentRepository;
  readonly vouchers: VoucherRepository;
  readonly ledger: LedgerRepository;
}

/** Mã phân loại lưu ở `failure_reason` khi cổng báo thất bại (không PII). */
export const GATEWAY_FAILED_REASON = 'GATEWAY_REPORTED_FAILURE';

/**
 * Xử lý webhook thanh toán (BE-S4-03). Chữ ký sai → `WEBHOOK_INVALID`, không mở transaction.
 * Mọi thay đổi của một webhook nằm trong **một transaction**: khoá dòng payment theo `order_id` (`FOR UPDATE`) →
 * kiểm tra lại trạng thái → `SUCCEEDED`: payment `markSucceeded` + voucher `RESERVED` + ledger `CHARGE`
 * (`DEPOSIT_VND`) + `VOUCHER_ISSUE` (`VOUCHER_VND`), event `PaymentSucceeded`/`VoucherIssued` qua outbox;
 * `FAILED`: `markFailed`. Webhook lặp lại (tuần tự hay đồng thời) thấy trạng thái đã đổi → `DUPLICATE`; thêm lớp
 * bảo vệ ở DB: unique `gateway_txn_id`, `vouchers.payment_id`, ledger theo (payment, loại).
 */
export class HandlePaymentWebhook {
  constructor(private readonly deps: HandlePaymentWebhookDeps) {}

  async execute(cmd: HandlePaymentWebhookCommand): Promise<Result<WebhookResult, DomainError>> {
    const verified = await this.deps.gateway.verifyWebhook(cmd.headers, cmd.rawBody);
    if (verified.isErr()) return fail(WEBHOOK_INVALID);
    const event = verified.value;

    return this.deps.uow.run(async (tx) => {
      const payment = await this.deps.payments.findByOrderIdForUpdate(tx, event.orderId);
      if (payment === null) return ok(result(event, 'UNKNOWN_ORDER', null));
      return event.status === 'SUCCEEDED' ? this.succeed(tx, payment, event) : this.fail(tx, payment, event);
    });
  }

  private async succeed(
    tx: Tx,
    payment: VerificationPayment,
    event: WebhookEvent,
  ): Promise<Result<WebhookResult, DomainError>> {
    if (payment.gatewayTxnId === event.gatewayTxnId) return ok(result(event, 'DUPLICATE', payment));
    if (payment.status !== 'PENDING') return ok(result(event, 'IGNORED', payment));
    if (event.amount !== payment.amount.amount) return ok(result(event, 'AMOUNT_MISMATCH', payment));

    const before = result(event, 'SUCCEEDED', payment);
    const now = this.deps.clock.now();
    const marked = payment.markSucceeded(event.gatewayTxnId, now);
    if (marked.isErr()) return err(marked.error);

    const voucher = Voucher.issue(
      { id: newId<'Voucher'>(), userId: payment.userId, paymentId: payment.id },
      now,
    );
    const charge = LedgerEntry.create({
      id: newId<'LedgerEntry'>(),
      type: 'CHARGE',
      amount: payment.amount,
      userId: payment.userId,
      paymentId: payment.id,
      voucherId: null,
      occurredAt: now,
    });
    if (charge.isErr()) return err(charge.error);
    const issue = LedgerEntry.create({
      id: newId<'LedgerEntry'>(),
      type: 'VOUCHER_ISSUE',
      amount: voucher.value,
      userId: payment.userId,
      paymentId: payment.id,
      voucherId: voucher.id,
      occurredAt: now,
    });
    if (issue.isErr()) return err(issue.error);

    await this.deps.payments.save(tx, payment);
    await this.deps.vouchers.insert(tx, voucher);
    await this.deps.ledger.append(tx, [charge.value, issue.value]);
    return ok(before);
  }

  private async fail(
    tx: Tx,
    payment: VerificationPayment,
    event: WebhookEvent,
  ): Promise<Result<WebhookResult, DomainError>> {
    if (payment.status === 'FAILED') return ok(result(event, 'DUPLICATE', payment));
    if (payment.status !== 'PENDING') return ok(result(event, 'IGNORED', payment));
    const before = result(event, 'FAILED', payment);
    const marked = payment.markFailed(GATEWAY_FAILED_REASON, this.deps.clock.now());
    if (marked.isErr()) return err(marked.error);
    await this.deps.payments.save(tx, payment);
    return ok(before);
  }
}

const result = (
  event: WebhookEvent,
  outcome: WebhookOutcome,
  payment: VerificationPayment | null,
): WebhookResult => ({
  outcome,
  orderId: event.orderId,
  gatewayTxnId: event.gatewayTxnId,
  paymentId: payment?.id ?? null,
  paymentStatus: payment?.status ?? null,
});
