/**
 * Mã lỗi hoàn tiền (BE-S4-04, tầng application) — đăng ký HTTP status ở contracts `billing/errors.ts`
 * (`BILLING_REFUND_ERROR_CODES`); test `refund-use-cases.test.ts` kiểm tra điều này.
 */
export const BILLING_REFUND_ERRORS = ['PAYMENT_NOT_FOUND'] as const;

export type BillingRefundErrorCode = (typeof BILLING_REFUND_ERRORS)[number];
