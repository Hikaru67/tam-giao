/**
 * Event payload của module billing (phát qua outbox). Không chứa PII. Số tiền là VND nguyên (`number`, số nguyên
 * an toàn) vì JSON không tuần tự hoá được `bigint`.
 */

/** Cổng xác nhận thanh toán xác thực thành công. */
export const PAYMENT_SUCCEEDED = 'PaymentSucceeded';
export interface PaymentSucceededPayload {
  readonly paymentId: string;
  readonly orderId: string;
  readonly userId: string;
  readonly amountVnd: number;
  readonly gatewayTxnId: string;
}

/** Thanh toán thất bại / bị huỷ phía cổng. `reason` là mã phân loại của cổng (nếu có). */
export const PAYMENT_FAILED = 'PaymentFailed';
export interface PaymentFailedPayload {
  readonly paymentId: string;
  readonly orderId: string;
  readonly userId: string;
  readonly reason: string | null;
}

/** Hoàn tiền thanh toán xác thực thành công (100%). */
export const REFUND_COMPLETED = 'RefundCompleted';
export interface RefundCompletedPayload {
  readonly paymentId: string;
  readonly orderId: string;
  readonly userId: string;
  readonly amountVnd: number;
}

/** Voucher được phát hành ở trạng thái `RESERVED` (sau khi thanh toán thành công). */
export const VOUCHER_ISSUED = 'VoucherIssued';
export interface VoucherIssuedPayload {
  readonly voucherId: string;
  readonly userId: string;
  readonly paymentId: string;
  readonly valueVnd: number;
}

/** Voucher được kích hoạt (`ACTIVE`). `expiresAt` dạng ISO 8601 UTC. */
export const VOUCHER_ACTIVATED = 'VoucherActivated';
export interface VoucherActivatedPayload {
  readonly voucherId: string;
  readonly userId: string;
  readonly expiresAt: string;
}

/** Voucher được quán đối tác đổi. */
export const VOUCHER_REDEEMED = 'VoucherRedeemed';
export interface VoucherRedeemedPayload {
  readonly voucherId: string;
  readonly userId: string;
  readonly partnerId: string;
  readonly valueVnd: number;
}

/** Voucher bị huỷ (vd hoàn tiền thanh toán). `reason` là mã lý do, không PII. */
export const VOUCHER_VOIDED = 'VoucherVoided';
export interface VoucherVoidedPayload {
  readonly voucherId: string;
  readonly userId: string;
  readonly paymentId: string;
  readonly reason: string;
  readonly valueVnd: number;
}

/** Voucher hết hạn chưa dùng (job định kỳ). */
export const VOUCHER_EXPIRED_EVENT = 'VoucherExpired';
export interface VoucherExpiredPayload {
  readonly voucherId: string;
  readonly userId: string;
  readonly valueVnd: number;
}
