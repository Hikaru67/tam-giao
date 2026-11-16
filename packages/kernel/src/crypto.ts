/**
 * Port mã hoá dữ liệu nhạy cảm (số CCCD, thu nhập, tài sản…) — AGENTS.md mục 5.
 * Chỉ infrastructure (repository/mapper) gọi các port này; domain chỉ thấy Value Object đã giải mã.
 */
export interface Encryptor {
  /**
   * Mã hoá `plaintext`. `context` ràng buộc ciphertext với vị trí lưu (vd `verification.cccd_number:<userId>`):
   * giải mã với context khác sẽ thất bại, nên không thể chép ciphertext sang bản ghi/cột khác.
   */
  encrypt(plaintext: string, context: string): Promise<Uint8Array>;
  /** Giải mã; ciphertext bị sửa, context sai hoặc khoá không tồn tại → throw (lỗi hạ tầng, không phải lỗi nghiệp vụ). */
  decrypt(ciphertext: Uint8Array, context: string): Promise<string>;
}

/**
 * Tạo chỉ mục mù (blind index) để tìm kiếm/kiểm tra trùng trên dữ liệu đã mã hoá mà không lưu bản rõ.
 * Cùng `value` + `purpose` → cùng kết quả; khác `purpose` → kết quả không so sánh được với nhau.
 */
export interface BlindIndexer {
  index(value: string, purpose: string): string;
}
