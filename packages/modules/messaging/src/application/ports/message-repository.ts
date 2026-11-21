import type { Tx } from '@tamgiao/kernel';
import type { ConversationId, ConversationUserId } from '../../domain/conversation.js';
import type { ClientMessageId, Message, MessageId, MessageState } from '../../domain/message.js';

/** Lưu tin nhắn (`messaging.messages`). Mọi thao tác chạy trong `tx` của caller (A5). */
export interface MessageRepository {
  /** Ghi tin mới + event (`MessageSent`, `MessageFlagged`) vào outbox trong cùng `tx` (A6). */
  save(tx: Tx, message: Message): Promise<void>;

  /** Số tin `senderId` đã gửi trong hội thoại với `sentAt > since` (đếm rate limit). */
  countSentSince(
    tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly senderId: ConversationUserId;
      readonly since: Date;
    },
  ): Promise<number>;

  /** Tin người dùng `senderId` đã gửi với idempotency key `clientMessageId` (unique ở DB) — BE-S6-02. */
  findByClientMessageId(
    tx: Tx,
    input: { readonly senderId: ConversationUserId; readonly clientMessageId: ClientMessageId },
  ): Promise<MessageState | null>;

  /**
   * Tối đa `limit` tin của hội thoại mà `viewerId` được thấy (`visible_to` null hoặc = người xem) có id > `afterId`
   * (id UUID v7 ~ thứ tự thời gian), tăng dần theo id; `afterId` `null` = từ tin đầu tiên. Dùng cho client nối lại lấy
   * tin bị lỡ (BE-S6-02).
   */
  listAfter(
    tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly viewerId: ConversationUserId;
      readonly afterId: MessageId | null;
      readonly limit: number;
    },
  ): Promise<readonly MessageState[]>;
}
