/** Tóm tắt hồ sơ người nộp hiển thị ở hàng chờ duyệt. Chứa PII (họ tên) — nơi nhận không được log. */
export interface ApplicantSummary {
  readonly userId: string;
  readonly fullName: string | null;
  readonly occupation: string | null;
}

/**
 * Tra họ tên / nghề nghiệp người nộp ở module profile cho màn duyệt eKYC (BE-S3-04). Composition root nối vào
 * facade read-only của profile — verification không đọc bảng `profile.*` (A3) và không phụ thuộc package profile.
 */
export interface ApplicantDirectory {
  /** Id người dùng có họ tên hoặc nghề nghiệp chứa `text` (không phân biệt hoa/thường), tối đa `limit` id. */
  searchUserIds(text: string, limit: number): Promise<readonly string[]>;
  /** Tóm tắt của các người dùng có hồ sơ; người chưa có hồ sơ không có mặt trong kết quả. */
  getApplicantSummaries(userIds: readonly string[]): Promise<readonly ApplicantSummary[]>;
}
