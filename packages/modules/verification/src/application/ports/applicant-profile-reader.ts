/**
 * Đọc họ tên + ngày sinh người dùng đã khai ở hồ sơ (module profile) để đối chiếu với OCR CCCD.
 * Composition root nối vào facade read-only của profile — verification không phụ thuộc trực tiếp package profile
 * (tránh vòng phụ thuộc khi profile dùng facade verification ở BE-S3-07).
 */
export interface ApplicantProfileReader {
  /** `null` khi người dùng chưa có hồ sơ hoặc chưa khai đủ họ tên / ngày sinh (`YYYY-MM-DD`). */
  getApplicantIdentity(
    userId: string,
  ): Promise<{ readonly fullName: string; readonly birthDate: string } | null>;
}
