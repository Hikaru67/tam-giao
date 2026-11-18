/**
 * Đọc trạng thái thanh toán xác thực (module billing) trước khi cho nộp eKYC (BE-S4-03). Composition root nối vào
 * `BillingFacade.hasPaidVerification` — verification không phụ thuộc trực tiếp package billing (cùng cách với
 * `ApplicantProfileReader`).
 */
export interface PaymentStatusReader {
  /** `true` khi người dùng đã thanh toán xác thực thành công (không tính khoản đang/đã hoàn tiền). */
  hasPaidVerification(userId: string): Promise<boolean>;
}
