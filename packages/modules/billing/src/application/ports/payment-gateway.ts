import type { Result } from '@tamgiao/kernel';

/**
 * Số tiền gửi/nhận qua cổng thanh toán: **số nguyên VND dạng `bigint`** (không số thực — AGENTS.md A8).
 * Chọn `bigint` để khớp `Money.amount` của kernel và cột `bigint` trong DB: use case chỉ cần
 * `money.amount` / `Money.of(amount)`, không phải đổi kiểu, không có rủi ro vượt `Number.MAX_SAFE_INTEGER`.
 */
export type GatewayAmountVnd = bigint;

/** Phiên thanh toán vừa tạo trên cổng. */
export interface CheckoutSession {
  /** URL trang thanh toán của cổng (mở trong trình duyệt/webview). */
  readonly checkoutUrl: string;
  /** Chuỗi dữ liệu để client tự vẽ mã QR (vd VietQR/EMVCo). */
  readonly qrData: string;
}

export const WEBHOOK_PAYMENT_STATUSES = ['SUCCEEDED', 'FAILED'] as const;
export type WebhookPaymentStatus = (typeof WEBHOOK_PAYMENT_STATUSES)[number];

/** Sự kiện thanh toán đã **xác thực chữ ký** và chuẩn hoá từ webhook của cổng. */
export interface WebhookEvent {
  /** Mã giao dịch phía cổng — khoá idempotency của webhook (unique `gateway_txn_id`, BE-S4-03). */
  readonly gatewayTxnId: string;
  /** Mã đơn phía mình, đã truyền vào `createCheckout`. */
  readonly orderId: string;
  readonly amount: GatewayAmountVnd;
  readonly status: WebhookPaymentStatus;
  /** Thời điểm giao dịch theo cổng (UTC). */
  readonly occurredAt: Date;
}

/** Header HTTP của request webhook. Adapter phải so khớp tên header **không phân biệt hoa thường**. */
export type WebhookHeaders = Readonly<Record<string, string | undefined>>;

/** Webhook không hợp lệ: thiếu/sai chữ ký, body bị sửa, sai định dạng. Endpoint trả 401, không ghi gì. */
export const WEBHOOK_INVALID = 'WEBHOOK_INVALID' as const;
export type WebhookInvalid = typeof WEBHOOK_INVALID;

export interface RefundReceipt {
  /** Mã giao dịch hoàn tiền phía cổng. */
  readonly gatewayRefundId: string;
}

/**
 * Phân loại lỗi hạ tầng khi gọi cổng thanh toán:
 * - `TIMEOUT`: quá thời gian chờ — **tạm thời**.
 * - `UNAVAILABLE`: lỗi mạng / 5xx / bị giới hạn tần suất — **tạm thời**.
 * - `REJECTED`: cổng từ chối hẳn (giao dịch không tồn tại, đã hoàn, số tiền vượt…) — **vĩnh viễn**.
 * - `BAD_RESPONSE`: phản hồi sai định dạng / thiếu trường bắt buộc — **vĩnh viễn**.
 * - `UNEXPECTED`: lỗi không phân loại được (bug adapter…) — **vĩnh viễn**.
 */
export const PAYMENT_GATEWAY_ERROR_KINDS = [
  'TIMEOUT',
  'UNAVAILABLE',
  'REJECTED',
  'BAD_RESPONSE',
  'UNEXPECTED',
] as const;
export type PaymentGatewayErrorKind = (typeof PAYMENT_GATEWAY_ERROR_KINDS)[number];

export type PaymentGatewayOperation = 'createCheckout' | 'refund';

/**
 * Lỗi hạ tầng **có phân loại** của cổng thanh toán (throw, không phải `Result` — AGENTS.md A4).
 * Job hoàn tiền (BE-S4-04) dựa vào `retryable` để retry backoff hay dừng và báo vận hành.
 * Message chỉ chứa phân loại + thao tác, không chứa dữ liệu người dùng.
 */
export class PaymentGatewayError extends Error {
  override readonly name = 'PaymentGatewayError';

  constructor(
    readonly kind: PaymentGatewayErrorKind,
    readonly operation: PaymentGatewayOperation,
    options?: { readonly cause?: unknown },
  ) {
    super(
      `Payment gateway ${operation} failed: ${kind}`,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
  }

  /** Lỗi tạm thời, gọi lại (backoff) có thể thành công. */
  get retryable(): boolean {
    return this.kind === 'TIMEOUT' || this.kind === 'UNAVAILABLE';
  }
}

/**
 * Cổng thanh toán (chờ quyết định D3: PayOS/VNPay/MoMo).
 * - Webhook không hợp lệ → `Err('WEBHOOK_INVALID')`, không throw.
 * - Lỗi hạ tầng của `createCheckout`/`refund` → throw `PaymentGatewayError`.
 */
export interface PaymentGateway {
  createCheckout(orderId: string, amount: GatewayAmountVnd, returnUrl: string): Promise<CheckoutSession>;
  /** `rawBody` là body **nguyên văn** (chưa parse) — chữ ký tính trên đúng các byte này. */
  verifyWebhook(headers: WebhookHeaders, rawBody: string): Promise<Result<WebhookEvent, WebhookInvalid>>;
  refund(gatewayTxnId: string, amount: GatewayAmountVnd): Promise<RefundReceipt>;
}
