import { createHmac, timingSafeEqual } from 'node:crypto';
import { err, newId, ok, SystemClock, type Clock, type Result } from '@tamgiao/kernel';
import {
  PaymentGatewayError,
  WEBHOOK_INVALID,
  WEBHOOK_PAYMENT_STATUSES,
  type CheckoutSession,
  type GatewayAmountVnd,
  type PaymentGateway,
  type PaymentGatewayErrorKind,
  type RefundReceipt,
  type WebhookEvent,
  type WebhookHeaders,
  type WebhookInvalid,
  type WebhookPaymentStatus,
} from '../../application/ports/payment-gateway.js';

/** Header chứa chữ ký HMAC-SHA256 (hex) của body webhook giả. */
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

export interface FakePaymentGatewayOptions {
  /** Secret ký webhook (HMAC-SHA256). */
  readonly secret: string;
  /** Nguồn thời gian cho `occurredAt` của webhook; mặc định `SystemClock`. */
  readonly clock?: Clock;
  /** Gốc URL trang thanh toán giả; mặc định `https://fake-gateway.local/checkout`. */
  readonly checkoutBaseUrl?: string;
  /** `refund` throw lỗi tạm thời ở N lần gọi đầu (để test retry backoff ở BE-S4-04). */
  readonly refundTransientFailures?: number;
  /** Loại lỗi tạm thời khi `refundTransientFailures > 0`; mặc định `UNAVAILABLE`. */
  readonly refundTransientKind?: Extract<PaymentGatewayErrorKind, 'TIMEOUT' | 'UNAVAILABLE'>;
  /**
   * `true`: `refund` chấp nhận cả giao dịch instance này không biết (vd fake trong worker — giao dịch do instance fake
   * của API tạo). Vẫn từ chối hoàn lần 2 cùng giao dịch. Chỉ cho dev (fake đã bị cấm ở production). Mặc định `false`.
   */
  readonly acceptUnknownRefunds?: boolean;
}

/** Webhook đã ký, sẵn sàng gửi tới `verifyWebhook` hoặc `POST /webhooks/payments/fake`. */
export interface SignedWebhook {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
}

export interface FakeRefundCall {
  readonly gatewayTxnId: string;
  readonly amount: GatewayAmountVnd;
  /** `true` nếu lần gọi này thành công (không throw). */
  readonly succeeded: boolean;
}

interface FakeCheckout {
  readonly amount: GatewayAmountVnd;
}

interface FakeTxn {
  readonly orderId: string;
  readonly amount: GatewayAmountVnd;
  readonly status: WebhookPaymentStatus;
  refunded: boolean;
}

/**
 * Cổng thanh toán giả cho dev/test khi D3 chưa chốt. Không gọi mạng.
 * - `simulatePayment` đóng vai cổng: tạo webhook đã ký cho một đơn đã `createCheckout`.
 * - `verifyWebhook` kiểm chữ ký HMAC-SHA256 bằng so sánh constant-time.
 * - `refund` ghi lại mọi lần gọi (`refundCalls`) và có thể lỗi tạm thời N lần đầu.
 */
export class FakePaymentGateway implements PaymentGateway {
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly checkoutBaseUrl: string;
  private refundTransientKind: 'TIMEOUT' | 'UNAVAILABLE';
  private refundFailuresLeft: number;
  private readonly acceptUnknownRefunds: boolean;
  private readonly checkouts = new Map<string, FakeCheckout>();
  private readonly txns = new Map<string, FakeTxn>();
  private readonly recordedRefunds: FakeRefundCall[] = [];

  constructor(options: FakePaymentGatewayOptions) {
    if (options.secret.length === 0) throw new Error('FakePaymentGateway: secret must not be empty');
    this.secret = options.secret;
    this.clock = options.clock ?? new SystemClock();
    this.checkoutBaseUrl = options.checkoutBaseUrl ?? 'https://fake-gateway.local/checkout';
    this.refundFailuresLeft = options.refundTransientFailures ?? 0;
    this.refundTransientKind = options.refundTransientKind ?? 'UNAVAILABLE';
    this.acceptUnknownRefunds = options.acceptUnknownRefunds ?? false;
  }

  get refundCalls(): readonly FakeRefundCall[] {
    return this.recordedRefunds;
  }

  /** Cấu hình lại số lần `refund` lỗi tạm thời sắp tới. */
  failNextRefunds(times: number, kind: 'TIMEOUT' | 'UNAVAILABLE' = this.refundTransientKind): void {
    this.refundFailuresLeft = times;
    this.refundTransientKind = kind;
  }

  async createCheckout(
    orderId: string,
    amount: GatewayAmountVnd,
    returnUrl: string,
  ): Promise<CheckoutSession> {
    if (orderId.length === 0 || amount <= 0n) {
      throw new PaymentGatewayError('REJECTED', 'createCheckout');
    }
    this.checkouts.set(orderId, { amount });
    const url = new URL(`${this.checkoutBaseUrl}/${encodeURIComponent(orderId)}`);
    url.searchParams.set('amount', amount.toString());
    url.searchParams.set('returnUrl', returnUrl);
    return { checkoutUrl: url.toString(), qrData: `FAKEPAY|${orderId}|${amount.toString()}` };
  }

  /**
   * Giả lập người dùng thanh toán xong trên cổng: trả webhook đã ký cho đơn `orderId`.
   * Đơn chưa `createCheckout` là lỗi lập trình → throw.
   */
  simulatePayment(orderId: string, outcome: WebhookPaymentStatus): SignedWebhook {
    const checkout = this.checkouts.get(orderId);
    if (checkout === undefined) {
      throw new Error(`FakePaymentGateway: no checkout for order ${orderId}`);
    }
    const gatewayTxnId = `fake_txn_${newId()}`;
    this.txns.set(gatewayTxnId, { orderId, amount: checkout.amount, status: outcome, refunded: false });
    const rawBody = JSON.stringify({
      gatewayTxnId,
      orderId,
      amount: checkout.amount.toString(),
      status: outcome,
      occurredAt: this.clock.now().toISOString(),
    });
    return {
      headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: this.sign(rawBody) },
      rawBody,
    };
  }

  async verifyWebhook(
    headers: WebhookHeaders,
    rawBody: string,
  ): Promise<Result<WebhookEvent, WebhookInvalid>> {
    const signature = findHeader(headers, FAKE_SIGNATURE_HEADER);
    if (signature === undefined || !this.signatureMatches(rawBody, signature)) {
      return err(WEBHOOK_INVALID);
    }
    const event = parseWebhookBody(rawBody);
    return event === undefined ? err(WEBHOOK_INVALID) : ok(event);
  }

  async refund(gatewayTxnId: string, amount: GatewayAmountVnd): Promise<RefundReceipt> {
    if (this.refundFailuresLeft > 0) {
      this.refundFailuresLeft -= 1;
      this.recordedRefunds.push({ gatewayTxnId, amount, succeeded: false });
      throw new PaymentGatewayError(this.refundTransientKind, 'refund');
    }
    if (this.acceptUnknownRefunds && !this.txns.has(gatewayTxnId) && amount > 0n) {
      this.txns.set(gatewayTxnId, { orderId: '', amount, status: 'SUCCEEDED', refunded: false });
    }
    const txn = this.txns.get(gatewayTxnId);
    if (
      txn === undefined ||
      txn.status !== 'SUCCEEDED' ||
      txn.refunded ||
      amount <= 0n ||
      amount > txn.amount
    ) {
      this.recordedRefunds.push({ gatewayTxnId, amount, succeeded: false });
      throw new PaymentGatewayError('REJECTED', 'refund');
    }
    txn.refunded = true;
    this.recordedRefunds.push({ gatewayTxnId, amount, succeeded: true });
    return { gatewayRefundId: `fake_refund_${newId()}` };
  }

  private sign(rawBody: string): string {
    return createHmac('sha256', this.secret).update(rawBody, 'utf8').digest('hex');
  }

  private signatureMatches(rawBody: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    const given = /^[0-9a-f]+$/i.test(signature) ? Buffer.from(signature, 'hex') : Buffer.alloc(0);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}

function findHeader(headers: WebhookHeaders, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && value !== undefined) return value;
  }
  return undefined;
}

function parseWebhookBody(rawBody: string): WebhookEvent | undefined {
  let data: unknown;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const { gatewayTxnId, orderId, amount, status, occurredAt } = data as Record<string, unknown>;
  if (typeof gatewayTxnId !== 'string' || gatewayTxnId.length === 0) return undefined;
  if (typeof orderId !== 'string' || orderId.length === 0) return undefined;
  if (typeof amount !== 'string' || !/^\d+$/.test(amount)) return undefined;
  if (typeof status !== 'string' || !isPaymentStatus(status)) return undefined;
  if (typeof occurredAt !== 'string') return undefined;
  const at = new Date(occurredAt);
  if (Number.isNaN(at.getTime())) return undefined;
  return { gatewayTxnId, orderId, amount: BigInt(amount), status, occurredAt: at };
}

function isPaymentStatus(value: string): value is WebhookPaymentStatus {
  return (WEBHOOK_PAYMENT_STATUSES as readonly string[]).includes(value);
}
