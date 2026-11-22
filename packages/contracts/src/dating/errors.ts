import { registerErrors } from '../errors.js';

/**
 * Mã lỗi module dating (BE-S7-01). Dùng lại mã đã có, không đăng ký lại: `CANCEL_TOO_LATE` (verification, 409 — huỷ
 * lịch hẹn khi còn chưa đủ `DATE_CANCEL_CUTOFF_HOURS` giờ trước giờ bắt đầu), `NOT_PARTICIPANT` (matching, 403 — người
 * ngoài cặp), `PARTNER_NOT_FOUND` (billing, 404 — quán không tồn tại hoặc đã tắt), `NOT_FOUND` / `INVALID_ID` (common).
 */
export const DATING_ERROR_CODES = registerErrors('dating', {
  /** `meta.status`: trạng thái match hiện tại (`null` khi người dùng không có match mở). Chỉ đặt hẹn khi `DATING`. */
  MATCH_NOT_DATING: { status: 409, title: 'Chỉ đặt lịch hẹn khi đang trong giai đoạn tìm hiểu' },
  /** `meta.datePlanId`: lịch đang mở (`PROPOSED | CONFIRMED | CHECKED_IN`) của match — mỗi match tối đa một lịch. */
  DATE_ALREADY_OPEN: { status: 409, title: 'Đã có lịch hẹn đang mở cho kết nối này' },
  /** `meta.reason`: `STARTS_IN_PAST` | `ENDS_BEFORE_START`. */
  DATE_TIME_INVALID: { status: 422, title: 'Khung giờ hẹn không hợp lệ' },
  /** Chỉ người được mời mới xác nhận / từ chối lịch hẹn. */
  DATE_NOT_INVITEE: { status: 403, title: 'Chỉ người được mời mới phản hồi lịch hẹn' },
  /** Quá hạn xác nhận (`expiresAt`) — lịch sẽ chuyển `EXPIRED`, người dùng có thể đề xuất lịch mới. */
  DATE_RESPONSE_EXPIRED: { status: 409, title: 'Lịch hẹn đã quá hạn xác nhận' },
  /** `meta.action`, `meta.status`: thao tác không hợp lệ ở trạng thái hiện tại của lịch hẹn. */
  DATE_INVALID_TRANSITION: {
    status: 409,
    title: 'Không thể thực hiện thao tác ở trạng thái hiện tại của lịch hẹn',
  },
});
