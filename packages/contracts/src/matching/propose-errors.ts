import { registerErrors } from '../errors.js';

/**
 * Mã lỗi use case `ProposeMatch` — chuyên viên đề xuất ghép đôi (BE-S5-04). Dùng chung với các mã đã có:
 * `USER_BUSY`, `USER_COOLING_DOWN`, `PAIR_ALREADY_TRIED` (`slot-errors.ts`), `CANDIDATE_PROFILE_NOT_FOUND`
 * (`candidate-dto.ts`; khi đề xuất: `meta.userIds` = người chưa có hồ sơ trong read model), `INVALID_ID` (common).
 */
export const MATCHING_PROPOSE_ERROR_CODES = registerErrors('matching', {
  /** Hai phía của đề xuất là cùng một người. */
  MATCH_SAME_USER: { status: 422, title: 'Không thể ghép đôi một người với chính họ' },
  /** `meta.userIds`: người chưa được duyệt xác thực (verification khác `APPROVED`). */
  USER_NOT_VERIFIED: { status: 409, title: 'Người dùng chưa hoàn tất xác thực' },
  /** Cặp vi phạm bộ lọc cứng hai chiều (giới tính, tuổi, khu vực, tôn giáo, kế hoạch con cái). */
  HARD_FILTER_MISMATCH: { status: 409, title: 'Cặp không thoả tiêu chí bắt buộc của hai người' },
});
