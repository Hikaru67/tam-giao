import { registerErrors } from '../errors.js';

/**
 * Mã lỗi module messaging (BE-S6-01). Dùng lại mã đã có, không đăng ký lại: `NOT_PARTICIPANT` (matching, 403 —
 * người gửi không thuộc hội thoại), `RATE_LIMITED` (common, 429 — vượt `MESSAGE_RATE_LIMIT_PER_MINUTE`),
 * `NOT_FOUND` / `INVALID_ID` (common).
 */
export const MESSAGING_ERROR_CODES = registerErrors('messaging', {
  /** `meta.reason`: `CLOSED` (match đã đóng/khoá) | `PERIOD_ENDED` (đã qua `closesAt`). Hội thoại không nhận tin. */
  CONVERSATION_CLOSED: { status: 409, title: 'Cuộc trò chuyện đã đóng' },
  /** Tin rỗng sau khi bỏ khoảng trắng hai đầu. */
  MESSAGE_EMPTY: { status: 422, title: 'Tin nhắn không được để trống' },
  /** `meta.maxLength`, `meta.length`: tin dài quá `MESSAGE_MAX_LENGTH` ký tự. */
  MESSAGE_TOO_LONG: { status: 422, title: 'Tin nhắn quá dài' },
});
