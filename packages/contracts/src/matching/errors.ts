import { registerErrors } from '../errors.js';

/** Mã lỗi domain aggregate `Match` (BE-S5-01). `ALREADY_RESPONDED` dùng chung cho use case BE-S5-05. */
export const MATCHING_ERROR_CODES = registerErrors('matching', {
  /** `meta.action`, `meta.status`, `meta.reason` (tuỳ chọn): thao tác không hợp lệ ở trạng thái hiện tại của match. */
  INVALID_TRANSITION: { status: 409, title: 'Thao tác không hợp lệ với trạng thái ghép đôi hiện tại' },
  /** `meta.status`, `meta.expiresAt`: đã quá hạn suy nghĩ / chờ phản hồi (`now >= expiresAt`). */
  OFFER_EXPIRED: { status: 410, title: 'Gợi ý ghép đôi đã hết hạn' },
  /** Người thao tác không thuộc cặp ghép đôi. */
  NOT_PARTICIPANT: { status: 403, title: 'Bạn không thuộc cặp ghép đôi này' },
  /** `meta.status`, `meta.expiresAt`: job hết hạn chạy trước `expiresAt` — job bỏ qua. */
  NOT_YET_EXPIRED: { status: 409, title: 'Ghép đôi chưa tới hạn' },
  /** `meta.status`: người dùng đã đồng ý trước đó (bấm lại "Đồng ý" hoặc "Bỏ qua" sau khi đã đồng ý). */
  ALREADY_RESPONDED: { status: 409, title: 'Bạn đã phản hồi gợi ý này' },
});
