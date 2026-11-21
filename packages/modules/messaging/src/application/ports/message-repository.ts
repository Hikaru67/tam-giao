import type { Tx } from '@tamgiao/kernel';
import type { ConversationId, ConversationUserId } from '../../domain/conversation.js';
import type { Message } from '../../domain/message.js';

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
}
