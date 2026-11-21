/**
 * Facade read-only của module billing cho module khác (AGENTS.md A3, BE-S4-03). Chỉ chứa kiểu; module khác
 * (verification, profile) không đọc bảng `billing.*`. Mỗi lời gọi tự mở transaction ngắn.
 */
export interface BillingFacade {
  /**
   * `true` khi người dùng có khoản thanh toán xác thực `SUCCEEDED`. Khoản đang/đã hoàn tiền (`REFUND_PENDING`,
   * `REFUNDED`) không tính là đã thanh toán.
   */
  hasPaidVerification(userId: string): Promise<boolean>;
}
