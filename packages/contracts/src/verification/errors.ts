import { registerErrors } from '../errors.js';

/** Mã lỗi module verification (BE-S3-01 trở đi thêm mã vào đây). */
export const VERIFICATION_ERROR_CODES = registerErrors('verification', {
  INVALID_CCCD_NUMBER: { status: 422, title: 'Số CCCD không hợp lệ (cần 12 chữ số)' },
  /** `meta.field` = `code` (thiếu/sai mã lý do) hoặc `note` (thiếu ghi chú khi lý do `OTHER`, hoặc quá dài). */
  REJECTION_REASON_REQUIRED: { status: 422, title: 'Từ chối hồ sơ cần chọn lý do hợp lệ' },
  KYC_MORE_INFO_ITEMS_REQUIRED: { status: 422, title: 'Cần chọn ít nhất một tài liệu cần bổ sung' },
  /** `meta.action`, `meta.status`: thao tác không hợp lệ ở trạng thái hiện tại của hồ sơ. */
  KYC_INVALID_TRANSITION: { status: 409, title: 'Thao tác không hợp lệ với trạng thái hồ sơ hiện tại' },
  /** `meta.steps` liệt kê các bước chưa đạt. */
  KYC_STEPS_INCOMPLETE: { status: 409, title: 'Chưa đủ 4 bước kiểm tra đạt, không thể duyệt' },
  KYC_ALREADY_DECIDED: { status: 409, title: 'Hồ sơ đã được quyết định (duyệt hoặc từ chối)' },
  /** Số CCCD đọc được đã gắn với hồ sơ của tài khoản khác (1 CCCD ↔ 1 tài khoản). */
  CCCD_ALREADY_REGISTERED: { status: 409, title: 'Số CCCD đã được dùng cho tài khoản khác' },
  /** `meta.status`: hồ sơ đã nộp và chưa ở trạng thái được nộp lại (chỉ `NEEDS_MORE_INFO` được nộp bổ sung). */
  KYC_ALREADY_SUBMITTED: { status: 409, title: 'Hồ sơ xác thực đã được nộp' },
  /** `meta.missing` liệt kê trường key tài liệu còn thiếu. */
  KYC_DOCS_MISSING: { status: 422, title: 'Thiếu tài liệu xác thực bắt buộc' },
  /** Admin mở / quyết định hồ sơ không tồn tại (BE-S3-04). */
  KYC_SUBMISSION_NOT_FOUND: { status: 404, title: 'Không tìm thấy hồ sơ xác thực' },
  /**
   * Đánh dấu bước `CCCD_CHIP` đạt khi hồ sơ chưa đọc được số CCCD — chặn lách kiểm tra 1 CCCD ↔ 1 tài khoản
   * (ảnh mờ → OCR không ra số). Yêu cầu người dùng bổ sung ảnh CCCD (BE-S3-04).
   */
  KYC_CCCD_NUMBER_MISSING: { status: 409, title: 'Hồ sơ chưa có số CCCD, không thể xác nhận bước CCCD' },
});
