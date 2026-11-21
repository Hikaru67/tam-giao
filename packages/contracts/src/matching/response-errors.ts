import { registerErrors } from '../errors.js';

/**
 * Mã lỗi use case phản hồi lời ngỏ `AcceptOffer` / `DeclineOffer` / `WithdrawIntro` (BE-S5-05). Dùng chung với các mã
 * domain đã có (`matching/errors.ts`): `OFFER_EXPIRED`, `ALREADY_RESPONDED`, `INVALID_TRANSITION`.
 */
export const MATCHING_RESPONSE_ERROR_CODES = registerErrors('matching', {
  /** Người dùng không có match đang mở (`OFFERED | AWAITING_RESPONSE | DATING | MET`) để phản hồi. */
  NO_OPEN_MATCH: { status: 404, title: 'Không có ghép đôi đang mở' },
});
