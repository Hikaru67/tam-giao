import { registerErrors } from '../errors.js';

/** Mã lỗi độc quyền 1-1, cooldown, lịch sử cặp của module matching (BE-S5-02). */
export const MATCHING_SLOT_ERROR_CODES = registerErrors('matching', {
  /** `meta.userIds`: uuid người đang ở trong một match mở khác (độc quyền 1-1). */
  USER_BUSY: { status: 409, title: 'Người dùng đang trong một ghép đôi khác' },
  /** Người dùng đang trong thời gian nghỉ sau khi dừng tìm hiểu (`COOLDOWN_DAYS`). */
  USER_COOLING_DOWN: { status: 409, title: 'Người dùng đang trong thời gian nghỉ sau ghép đôi' },
  /** Cặp này đã từng được đề xuất (đã từ chối / hết hạn / đóng) — không đề xuất lại. */
  PAIR_ALREADY_TRIED: { status: 409, title: 'Cặp này đã từng được đề xuất' },
});
