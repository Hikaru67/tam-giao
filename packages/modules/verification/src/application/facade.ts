/**
 * Facade read-only của module verification cho module khác (AGENTS.md A3, BE-S3-07). Chỉ chứa kiểu + thao tác
 * chỉ-đọc; module khác (profile, matching) không đọc bảng `verification.*`. Mỗi lời gọi tự mở transaction ngắn.
 */

/** Huy hiệu xác thực — trùng `VERIFICATION_BADGES` trong `@tamgiao/contracts` (có test đối chiếu). */
export const VERIFICATION_BADGES = ['CCCD_VERIFIED', 'SINGLE_VERIFIED', 'INTERVIEWED'] as const;
export type VerificationBadge = (typeof VERIFICATION_BADGES)[number];

/**
 * Trạng thái xác thực tổng hợp:
 * - `NOT_SUBMITTED`: chưa có hồ sơ hoặc hồ sơ còn nháp (`DRAFT`).
 * - `IN_PROGRESS`: đã nộp, chưa quyết định (`SUBMITTED`, `UNDER_REVIEW`, `NEEDS_MORE_INFO`).
 * - `APPROVED` / `REJECTED`: chuyên viên đã quyết định.
 */
export const VERIFICATION_STATUSES = ['NOT_SUBMITTED', 'IN_PROGRESS', 'APPROVED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface VerificationSummary {
  readonly status: VerificationStatus;
  /** Theo thứ tự `VERIFICATION_BADGES`; luôn rỗng khi hồ sơ `REJECTED`. */
  readonly badges: readonly VerificationBadge[];
}

export interface VerificationFacade {
  /** `true` khi hồ sơ đã được duyệt (`APPROVED`). */
  isVerified(userId: string): Promise<boolean>;
  /**
   * Huy hiệu theo từng bước đã `PASSED`: `CCCD_CHIP` → `CCCD_VERIFIED`, `MARITAL_STATUS` → `SINGLE_VERIFIED`,
   * `INTERVIEW` → `INTERVIEWED`. Hồ sơ bị từ chối → không có huy hiệu nào.
   */
  getBadges(userId: string): Promise<readonly VerificationBadge[]>;
  /** Trạng thái + huy hiệu đọc trong cùng một transaction (dùng cho `GET /me`). */
  getSummary(userId: string): Promise<VerificationSummary>;
}
