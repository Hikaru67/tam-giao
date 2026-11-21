import { registerErrors } from '../errors.js';

/** Mã lỗi module safety (BE-S6-05). */
export const SAFETY_ERROR_CODES = registerErrors('safety', {
  /**
   * `meta.reason`: `SELF` (báo cáo chính mình) | `NEVER_MATCHED` (chưa từng được ghép với người này). Chỉ báo cáo
   * được người đang/đã từng ghép với mình.
   */
  REPORT_TARGET_INVALID: { status: 422, title: 'Chỉ báo cáo được người đang hoặc đã từng ghép đôi với bạn' },
  /** `meta.maxLength`: mô tả vượt `REPORT_DESCRIPTION_MAX_LENGTH` ký tự. */
  REPORT_DESCRIPTION_TOO_LONG: { status: 422, title: 'Mô tả báo cáo quá dài' },
  /** `meta.max`: quá `REPORT_MAX_EVIDENCE` ảnh bằng chứng. */
  REPORT_EVIDENCE_TOO_MANY: { status: 422, title: 'Quá số ảnh bằng chứng cho phép' },
  /** `meta.action`, `meta.status`: thao tác không hợp lệ với trạng thái xử lý hiện tại của báo cáo. */
  REPORT_INVALID_TRANSITION: { status: 409, title: 'Thao tác không hợp lệ với trạng thái báo cáo' },
  /** BE-S6-06: không có báo cáo với id này (admin). */
  REPORT_NOT_FOUND: { status: 404, title: 'Không tìm thấy báo cáo' },
  /** BE-S6-06 — `meta.maxLength`: kết luận rỗng hoặc quá dài. */
  REPORT_CONCLUSION_INVALID: { status: 422, title: 'Kết luận xử lý báo cáo không hợp lệ' },
  /** BE-S6-06 — `meta.maxLength`: lý do khoá tài khoản rỗng hoặc quá dài. */
  BAN_REASON_INVALID: { status: 422, title: 'Lý do khoá tài khoản không hợp lệ' },
  /** BE-S6-06: người dùng đã bị khoá vĩnh viễn trước đó. */
  USER_ALREADY_BANNED: { status: 409, title: 'Người dùng đã bị khoá' },
  /** BE-S6-06: không có tin bị gắn cờ với id này. */
  FLAGGED_MESSAGE_NOT_FOUND: { status: 404, title: 'Không tìm thấy tin bị gắn cờ' },
});
