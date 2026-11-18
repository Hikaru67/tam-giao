import { registerErrors } from '../errors.js';

/** Mã lỗi domain module billing: thanh toán xác thực, ledger, voucher (BE-S4-01). */
export const BILLING_ERROR_CODES = registerErrors('billing', {
  /** `meta.action`, `meta.status`: thao tác không hợp lệ ở trạng thái hiện tại của khoản thanh toán. */
  PAYMENT_INVALID_TRANSITION: {
    status: 409,
    title: 'Thao tác không hợp lệ với trạng thái thanh toán hiện tại',
  },
  /** Hoàn tiền khi thanh toán chưa thành công (`PENDING`/`FAILED`). */
  PAYMENT_NOT_REFUNDABLE: { status: 409, title: 'Thanh toán chưa thành công, không thể hoàn tiền' },
  /** Thanh toán đang hoặc đã được hoàn tiền. */
  PAYMENT_ALREADY_REFUNDED: { status: 409, title: 'Thanh toán đã được hoàn tiền' },
  LEDGER_AMOUNT_INVALID: { status: 422, title: 'Số tiền bút toán phải lớn hơn 0' },
  /** `meta.field`: tham chiếu bắt buộc theo loại bút toán (`paymentId` hoặc `voucherId`). */
  LEDGER_REFERENCE_REQUIRED: { status: 422, title: 'Bút toán thiếu tham chiếu bắt buộc' },
  /** `meta.action`, `meta.status`, `meta.reason` (tuỳ chọn). */
  VOUCHER_INVALID_TRANSITION: { status: 409, title: 'Thao tác không hợp lệ với trạng thái voucher hiện tại' },
  VOUCHER_NOT_ACTIVE: { status: 409, title: 'Voucher chưa được kích hoạt hoặc đã bị huỷ' },
  VOUCHER_ALREADY_REDEEMED: { status: 409, title: 'Voucher đã được sử dụng' },
  VOUCHER_EXPIRED: { status: 410, title: 'Voucher đã hết hạn' },
  VOUCHER_PARTNER_MISMATCH: { status: 403, title: 'Voucher không áp dụng tại quán này' },
});

/** Mã lỗi thanh toán xác thực + webhook (BE-S4-03). */
export const BILLING_PAYMENT_ERROR_CODES = registerErrors('billing', {
  /**
   * Chưa thanh toán xác thực → chưa được nộp eKYC. Dùng 403 vì `HttpErrorStatus` không có 402: yêu cầu hợp lệ nhưng
   * người dùng chưa đủ điều kiện thực hiện.
   */
  PAYMENT_REQUIRED: { status: 403, title: 'Cần hoàn tất thanh toán xác thực trước' },
  /** `meta.status`: người dùng đã có khoản thanh toán xác thực thành công (hoặc đang/đã hoàn tiền). */
  PAYMENT_ALREADY_EXISTS: { status: 409, title: 'Đã có khoản thanh toán xác thực' },
  /** Webhook thiếu/sai chữ ký hoặc sai định dạng — không ghi gì. */
  WEBHOOK_INVALID: { status: 401, title: 'Webhook thanh toán không hợp lệ' },
  /** `meta.kind`: không tạo được phiên thanh toán do cổng lỗi — thử lại sau (giữ nguyên idempotency key). */
  PAYMENT_GATEWAY_UNAVAILABLE: { status: 503, title: 'Cổng thanh toán tạm thời không khả dụng' },
});
