import { MESSAGE_MAX_LENGTH, MESSAGE_RATE_LIMIT_PER_MINUTE } from '@tamgiao/contracts/constants';
import { fail, ok, type DomainError, type Result } from '@tamgiao/kernel';

declare const MessageBodyBrand: unique symbol;

/**
 * Nội dung tin người dùng đã chuẩn hoá: bỏ khoảng trắng hai đầu, không rỗng, ≤ `MESSAGE_MAX_LENGTH` ký tự Unicode
 * (đếm theo code point để emoji/tiếng Việt tổ hợp không bị đếm gấp đôi). Nội dung là PII — không log, không đưa vào
 * event hay `details` của lỗi.
 */
export type MessageBody = string & { readonly [MessageBodyBrand]: true };

export type MessageBodyError = DomainError<'MESSAGE_EMPTY' | 'MESSAGE_TOO_LONG'>;

export function parseMessageBody(raw: string): Result<MessageBody, MessageBodyError> {
  const body = raw.trim();
  if (body.length === 0) return fail('MESSAGE_EMPTY');
  const length = [...body].length;
  if (length > MESSAGE_MAX_LENGTH) {
    return fail('MESSAGE_TOO_LONG', { maxLength: MESSAGE_MAX_LENGTH, length });
  }
  return ok(body as MessageBody);
}

/** Cửa sổ trượt của giới hạn tốc độ gửi tin. */
export const MESSAGE_RATE_WINDOW_SECONDS = 60;

export type MessageRateLimitError = DomainError<'RATE_LIMITED'>;

/**
 * Luật giới hạn tốc độ: trong `MESSAGE_RATE_WINDOW_SECONDS` giây gần nhất (tính tới `now`, không gồm tin đang gửi)
 * người gửi đã có `sentInWindow` tin ở hội thoại này; đạt `MESSAGE_RATE_LIMIT_PER_MINUTE` → `RATE_LIMITED`.
 */
export function checkMessageRateLimit(sentInWindow: number): Result<void, MessageRateLimitError> {
  if (sentInWindow >= MESSAGE_RATE_LIMIT_PER_MINUTE) {
    return fail('RATE_LIMITED', {
      limit: MESSAGE_RATE_LIMIT_PER_MINUTE,
      windowSeconds: MESSAGE_RATE_WINDOW_SECONDS,
    });
  }
  return ok();
}

/** Mốc bắt đầu cửa sổ đếm tin (bao gồm biên): tin có `sentAt > windowStart` được tính. */
export function messageRateWindowStart(now: Date): Date {
  return new Date(now.getTime() - MESSAGE_RATE_WINDOW_SECONDS * 1_000);
}

/**
 * Kết quả sàng lọc nội dung trước khi lưu (điểm cắm của bộ lọc lừa đảo / che liên hệ — BE-S6-03).
 * `maskedBody`: nội dung hiển thị cho người nhận khi có phần bị che, `null` = hiển thị nguyên `body`.
 * `flagged` + `reasons` (mã luật, không trích nội dung): tin bị gắn cờ → event `MessageFlagged`.
 */
export interface MessageScreening {
  readonly maskedBody: string | null;
  readonly flagged: boolean;
  readonly reasons: readonly string[];
}

/** Hàm sàng lọc nội dung thuần (domain service). BE-S6-03 thay bằng `FraudDetector` + `ContactMasker`. */
export type MessageScreener = (body: MessageBody) => MessageScreening;

/** Mặc định BE-S6-01: chưa lọc — không che, không gắn cờ. */
export const PASS_THROUGH_SCREENER: MessageScreener = () => ({
  maskedBody: null,
  flagged: false,
  reasons: [],
});
