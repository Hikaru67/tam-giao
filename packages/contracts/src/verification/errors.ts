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
});
