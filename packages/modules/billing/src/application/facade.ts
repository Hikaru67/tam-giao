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

/**
 * Facade read-only về quán đối tác cho module khác (BE-S7-01: dating chỉ cho đặt hẹn tại quán đang hoạt động). Tách
 * khỏi `BillingFacade` để module chỉ cần thanh toán (profile, verification) không phải hiện thực thêm phương thức.
 */
export interface BillingPartnerFacade {
  /** `true` khi quán tồn tại và đang `active`. Id không hợp lệ / không tồn tại / đã tắt → `false`. */
  isActivePartner(partnerId: string): Promise<boolean>;
}
