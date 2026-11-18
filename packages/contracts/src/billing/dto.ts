import { z } from 'zod';

/**
 * DTO thanh toán xác thực (BE-S4-03). Số tiền là VND nguyên (`number`, số nguyên an toàn) vì JSON không tuần tự hoá
 * được `bigint`.
 */

/** Trạng thái khoản thanh toán xác thực (khớp `PAYMENT_STATUSES` của domain billing — có test đối chiếu). */
export const VERIFICATION_PAYMENT_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;
export type VerificationPaymentStatus = (typeof VERIFICATION_PAYMENT_STATUSES)[number];

/** Header idempotency của `POST /me/payments/verification` (client sinh, vd UUID, giữ nguyên khi thử lại). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/**
 * `POST /me/payments/verification` — body tuỳ chọn. Idempotency key gửi qua header `Idempotency-Key` hoặc trường
 * `idempotencyKey` (gửi cả hai thì phải trùng nhau).
 */
export const createVerificationCheckoutBodySchema = z.object({
  idempotencyKey: idempotencyKeySchema.optional(),
});
export type CreateVerificationCheckoutBody = z.infer<typeof createVerificationCheckoutBodySchema>;

/** Phiên thanh toán: 201 khi vừa tạo, 200 khi trả lại phiên đã có (cùng key, hoặc đang có khoản `PENDING`). */
export const verificationCheckoutResponseSchema = z.object({
  paymentId: z.uuid(),
  orderId: z.string(),
  status: z.enum(VERIFICATION_PAYMENT_STATUSES),
  amountVnd: z.number().int(),
  /** URL trang thanh toán của cổng. */
  checkoutUrl: z.string(),
  /** Dữ liệu để app tự vẽ mã QR. */
  qrData: z.string(),
  createdAt: z.iso.datetime(),
});
export type VerificationCheckoutResponse = z.infer<typeof verificationCheckoutResponseSchema>;

/** Một khoản thanh toán trong lịch sử (`GET /me/payments`). `checkoutUrl`/`qrData` chỉ có khi còn `PENDING`. */
export const paymentHistoryItemSchema = z.object({
  paymentId: z.uuid(),
  orderId: z.string(),
  status: z.enum(VERIFICATION_PAYMENT_STATUSES),
  amountVnd: z.number().int(),
  checkoutUrl: z.string().nullable(),
  qrData: z.string().nullable(),
  createdAt: z.iso.datetime(),
  succeededAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
  refundedAt: z.iso.datetime().nullable(),
});
export type PaymentHistoryItem = z.infer<typeof paymentHistoryItemSchema>;

/** `GET /me/payments` — mới nhất trước. */
export const paymentHistoryResponseSchema = z.object({ items: z.array(paymentHistoryItemSchema) });
export type PaymentHistoryResponse = z.infer<typeof paymentHistoryResponseSchema>;

/**
 * Kết quả xử lý webhook (phản hồi 200 — cổng không gửi lại). Không chứa PII.
 * - `SUCCEEDED` / `FAILED`: đã ghi nhận chuyển trạng thái.
 * - `DUPLICATE`: webhook lặp lại, đã xử lý trước đó.
 * - `UNKNOWN_ORDER`: không có đơn tương ứng.
 * - `AMOUNT_MISMATCH`: số tiền khác khoản thanh toán — không ghi nhận, vận hành kiểm tra.
 * - `IGNORED`: trạng thái hiện tại không cho phép chuyển (vd đơn đã thất bại / đã thành công với giao dịch khác).
 */
export const WEBHOOK_OUTCOMES = [
  'SUCCEEDED',
  'FAILED',
  'DUPLICATE',
  'UNKNOWN_ORDER',
  'AMOUNT_MISMATCH',
  'IGNORED',
] as const;
export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number];
export const webhookAckResponseSchema = z.object({
  received: z.literal(true),
  outcome: z.enum(WEBHOOK_OUTCOMES),
});
export type WebhookAckResponse = z.infer<typeof webhookAckResponseSchema>;

/** `POST /dev/payments/fake/:orderId` (chỉ dev, gateway `fake`) — giả lập kết quả thanh toán. */
export const devFakePaymentBodySchema = z.object({ outcome: z.enum(['SUCCEEDED', 'FAILED']) });
export type DevFakePaymentBody = z.infer<typeof devFakePaymentBodySchema>;
