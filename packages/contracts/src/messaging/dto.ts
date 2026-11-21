import { z } from 'zod';
import { MESSAGE_MAX_LENGTH } from '../constants.js';
import { MESSAGE_KIND_NAMES, SYSTEM_MESSAGE_CODE_NAMES } from './events.js';

/**
 * DTO tin nhắn gửi tới client (WS `message.new`/`message.ack` và REST lịch sử — BE-S6-02). `body` đã chọn **theo người
 * xem**: người gửi thấy nội dung gốc của mình, người nhận thấy bản đã che liên hệ (nếu có). Không trả cờ lừa đảo
 * (`flagged`/lý do) cho client. Thời gian ISO 8601 UTC.
 */
export const conversationMessageSchema = z.object({
  /** UUID v7 — tăng theo thời gian, dùng làm con trỏ `after` khi nối lại. */
  messageId: z.uuid(),
  conversationId: z.uuid(),
  /** `null` với tin hệ thống. */
  senderId: z.uuid().nullable(),
  kind: z.enum(MESSAGE_KIND_NAMES),
  systemCode: z.enum(SYSTEM_MESSAGE_CODE_NAMES).nullable(),
  body: z.string(),
  /** `true` khi `body` người xem nhận là bản đã che một phần (SĐT/link…) — chỉ có ở phía người nhận. */
  masked: z.boolean(),
  /** Idempotency key client gửi kèm (chỉ trả cho chính người gửi; người khác nhận `null`). */
  clientMessageId: z.uuid().nullable(),
  sentAt: z.iso.datetime(),
});
export type ConversationMessageDto = z.infer<typeof conversationMessageSchema>;

/** Số tin tối đa mỗi lần lấy bù khi nối lại (`limit`). */
export const MESSAGES_AFTER_MAX_LIMIT = 100;
export const MESSAGES_AFTER_DEFAULT_LIMIT = 50;

/** `GET /me/conversations/:id/messages?after=&limit=` — tin sau tin `after` (UUID v7), tăng dần theo thời gian. */
export const messagesAfterQuerySchema = z.object({
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MESSAGES_AFTER_MAX_LIMIT).default(MESSAGES_AFTER_DEFAULT_LIMIT),
});
export type MessagesAfterQuery = z.infer<typeof messagesAfterQuerySchema>;

export const messagesAfterResponseSchema = z.object({
  items: z.array(conversationMessageSchema),
  /** Còn tin sau tin cuối của trang — gọi tiếp với `after` = `messageId` cuối. */
  hasMore: z.boolean(),
});
export type MessagesAfterResponse = z.infer<typeof messagesAfterResponseSchema>;

/**
 * Nội dung tin client gửi — chỉ chặn thô kích thước (≤ 2 × `MESSAGE_MAX_LENGTH` đơn vị UTF-16, đủ cho mọi tin hợp lệ
 * tính theo code point). Rỗng / quá dài theo luật domain (sau khi bỏ khoảng trắng) do server trả `MESSAGE_EMPTY` /
 * `MESSAGE_TOO_LONG`.
 */
export const messageBodyInputSchema = z.string().max(MESSAGE_MAX_LENGTH * 2);
