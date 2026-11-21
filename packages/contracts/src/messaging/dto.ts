import { z } from 'zod';
import { DATING_DAYS, MESSAGE_MAX_LENGTH } from '../constants.js';
import { CONVERSATION_STATUS_NAMES, MESSAGE_KIND_NAMES, SYSTEM_MESSAGE_CODE_NAMES } from './events.js';

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

/** Số tin tối đa mỗi lần lấy (`limit`). */
export const MESSAGES_AFTER_MAX_LIMIT = 100;
export const MESSAGES_AFTER_DEFAULT_LIMIT = 50;

/**
 * `GET /me/conversations/:id/messages?after=|before=&limit=` (BE-S6-02 + BE-S6-04). Con trỏ là `messageId` (UUID v7):
 * - `after=<id>`: các tin mới hơn `id` (cũ nhất trước) — lấy bù khi nối lại WS.
 * - `before=<id>`: `limit` tin ngay trước `id` — cuộn lên xem lịch sử; trang kế tiếp `before` = `messageId` đầu trang.
 * - không con trỏ: `limit` tin **mới nhất** (mở màn chat).
 * Không gửi cùng lúc `after` và `before`. Con trỏ theo id nên tin mới chen vào không làm trùng/sót trang cũ.
 */
export const messagesAfterQuerySchema = z
  .object({
    after: z.uuid().optional(),
    before: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(MESSAGES_AFTER_MAX_LIMIT).default(MESSAGES_AFTER_DEFAULT_LIMIT),
  })
  .refine((q) => q.after === undefined || q.before === undefined, {
    message: 'Chỉ dùng một trong hai con trỏ after / before',
    path: ['before'],
  });
export type MessagesAfterQuery = z.infer<typeof messagesAfterQuerySchema>;

export const messagesAfterResponseSchema = z.object({
  /** Luôn tăng dần theo thời gian (cũ → mới) ở cả ba chế độ. */
  items: z.array(conversationMessageSchema),
  /** `after`: còn tin mới hơn tin cuối trang. `before`/không con trỏ: còn tin cũ hơn tin đầu trang. */
  hasMore: z.boolean(),
});
export type MessagesAfterResponse = z.infer<typeof messagesAfterResponseSchema>;

/** Một dòng hộp thư (`GET /me/conversations`, BE-S6-04) nhìn từ người xem. */
export const conversationSummarySchema = z.object({
  conversationId: z.uuid(),
  /** Người còn lại trong cặp — FE tra hồ sơ hiển thị qua API profile. */
  peerUserId: z.uuid(),
  status: z.enum(CONVERSATION_STATUS_NAMES),
  openedAt: z.iso.datetime(),
  closesAt: z.iso.datetime(),
  /** Ngày X của giai đoạn tìm hiểu (1…`datingDays`); dừng tăng khi hội thoại đóng / hết hạn. */
  datingDay: z.number().int().min(1).max(DATING_DAYS),
  /** = `DATING_DAYS`. */
  datingDays: z.number().int(),
  /** Tin mới nhất người xem được thấy (nội dung theo người xem, như lịch sử); `null` khi chưa có tin. */
  lastMessage: conversationMessageSchema.nullable(),
  /** Số tin chưa đọc (không tính tin của chính mình; có tính tin hệ thống người xem được thấy). */
  unreadCount: z.number().int().min(0),
  /** Con trỏ đã đọc hiện tại; `null` = chưa đánh dấu đọc tin nào. */
  lastReadMessageId: z.uuid().nullable(),
});
export type ConversationSummaryDto = z.infer<typeof conversationSummarySchema>;

/** `GET /me/conversations` — hội thoại có hoạt động gần nhất trước (không phân trang: mỗi người chỉ vài hội thoại). */
export const conversationListResponseSchema = z.object({ items: z.array(conversationSummarySchema) });
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

/**
 * `POST /me/conversations/:id/read` — đánh dấu đã đọc tới `messageId` (BE-S6-04). Con trỏ chỉ tiến: gửi tin cũ hơn con
 * trỏ hiện tại không đổi gì. WS `message.read` dùng cùng luật (và lưu như REST).
 */
export const markConversationReadBodySchema = z.object({ messageId: z.uuid() });
export type MarkConversationReadBody = z.infer<typeof markConversationReadBodySchema>;

export const markConversationReadResponseSchema = z.object({
  conversationId: z.uuid(),
  /** Con trỏ sau thao tác (có thể lớn hơn `messageId` gửi lên nếu thiết bị khác đã đánh dấu xa hơn). */
  lastReadMessageId: z.uuid(),
  readAt: z.iso.datetime(),
  unreadCount: z.number().int().min(0),
});
export type MarkConversationReadResponse = z.infer<typeof markConversationReadResponseSchema>;

/** `GET /me/conversations/:id/icebreakers` — gợi ý phá băng theo ngày tìm hiểu hiện tại (BE-S6-04, danh sách tĩnh). */
export const icebreakersResponseSchema = z.object({
  conversationId: z.uuid(),
  datingDay: z.number().int().min(1).max(DATING_DAYS),
  datingDays: z.number().int(),
  /** Tên chặng (vd "Chủ đề sâu"). */
  theme: z.string(),
  topics: z.array(z.string()),
});
export type IcebreakersResponse = z.infer<typeof icebreakersResponseSchema>;

/**
 * Nội dung tin client gửi — chỉ chặn thô kích thước (≤ 2 × `MESSAGE_MAX_LENGTH` đơn vị UTF-16, đủ cho mọi tin hợp lệ
 * tính theo code point). Rỗng / quá dài theo luật domain (sau khi bỏ khoảng trắng) do server trả `MESSAGE_EMPTY` /
 * `MESSAGE_TOO_LONG`.
 */
export const messageBodyInputSchema = z.string().max(MESSAGE_MAX_LENGTH * 2);
