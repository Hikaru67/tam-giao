/**
 * Mã lỗi nghiệp vụ tầng domain của module billing (AGENTS.md A4) cho thanh toán xác thực, ledger và voucher.
 * Mỗi mã phải được đăng ký HTTP status ở `@tamgiao/contracts` (`billing/errors.ts`) — test
 * `billing-errors.test.ts` kiểm tra điều này. Mã lỗi quán đối tác (BE-S4-06) nằm ở file `partner*` riêng.
 */
export const BILLING_DOMAIN_ERRORS = [
  'PAYMENT_INVALID_TRANSITION',
  'PAYMENT_NOT_REFUNDABLE',
  'PAYMENT_ALREADY_REFUNDED',
  'LEDGER_AMOUNT_INVALID',
  'LEDGER_REFERENCE_REQUIRED',
  'VOUCHER_INVALID_TRANSITION',
  'VOUCHER_NOT_ACTIVE',
  'VOUCHER_ALREADY_REDEEMED',
  'VOUCHER_EXPIRED',
  'VOUCHER_PARTNER_MISMATCH',
] as const;

export type BillingDomainErrorCode = (typeof BILLING_DOMAIN_ERRORS)[number];

/**
 * Mã lỗi thanh toán xác thực + webhook (BE-S4-03, tầng application) — đăng ký ở contracts `billing/errors.ts`.
 * `PAYMENT_REQUIRED` do verification trả khi chưa thanh toán (facade billing).
 */
export const BILLING_PAYMENT_ERRORS = [
  'PAYMENT_REQUIRED',
  'PAYMENT_ALREADY_EXISTS',
  'WEBHOOK_INVALID',
  'PAYMENT_GATEWAY_UNAVAILABLE',
] as const;

export type BillingPaymentErrorCode = (typeof BILLING_PAYMENT_ERRORS)[number];
