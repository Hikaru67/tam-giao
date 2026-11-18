/**
 * Facade read-only của module profile cho module khác (AGENTS.md A3). Chỉ chứa kiểu + thao tác chỉ-đọc;
 * module khác không đọc bảng `profile.*`.
 */

/** Họ tên + ngày sinh (`YYYY-MM-DD`) người dùng đã khai. Chứa PII — nơi nhận không được log. */
export interface ApplicantIdentity {
  readonly fullName: string;
  readonly birthDate: string;
}

export interface ProfileFacade {
  /**
   * Thông tin định danh đã khai ở hồ sơ — verification dùng đối chiếu với OCR CCCD (BE-S3-03).
   * `null` khi chưa có hồ sơ hoặc chưa điền đủ họ tên / ngày sinh.
   */
  getApplicantIdentity(userId: string): Promise<ApplicantIdentity | null>;
}
