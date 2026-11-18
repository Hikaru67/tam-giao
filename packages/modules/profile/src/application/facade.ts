/**
 * Facade read-only của module profile cho module khác (AGENTS.md A3). Chỉ chứa kiểu + thao tác chỉ-đọc;
 * module khác không đọc bảng `profile.*`.
 */

/** Họ tên + ngày sinh (`YYYY-MM-DD`) người dùng đã khai. Chứa PII — nơi nhận không được log. */
export interface ApplicantIdentity {
  readonly fullName: string;
  readonly birthDate: string;
}

/** Tóm tắt hồ sơ cho màn duyệt eKYC của admin (BE-S3-04). Chứa PII (họ tên) — nơi nhận không được log. */
export interface ApplicantSummary {
  readonly userId: string;
  readonly fullName: string | null;
  readonly occupation: string | null;
}

export interface ProfileFacade {
  /**
   * Thông tin định danh đã khai ở hồ sơ — verification dùng đối chiếu với OCR CCCD (BE-S3-03).
   * `null` khi chưa có hồ sơ hoặc chưa điền đủ họ tên / ngày sinh.
   */
  getApplicantIdentity(userId: string): Promise<ApplicantIdentity | null>;
  /**
   * Id người dùng có họ tên hoặc nghề nghiệp chứa `text` (không phân biệt hoa/thường), tối đa `limit` id —
   * hàng chờ duyệt eKYC tìm theo tên/nghề (BE-S3-04).
   */
  searchUserIds(text: string, limit: number): Promise<readonly string[]>;
  /** Tóm tắt (họ tên, nghề nghiệp) của các người dùng đã có hồ sơ; người chưa có hồ sơ bị bỏ qua. */
  getApplicantSummaries(userIds: readonly string[]): Promise<readonly ApplicantSummary[]>;
}
