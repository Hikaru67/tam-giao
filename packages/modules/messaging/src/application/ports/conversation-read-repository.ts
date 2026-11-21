import type { Tx } from '@tamgiao/kernel';
import type { ConversationId, ConversationUserId } from '../../domain/conversation.js';
import type { MessageId } from '../../domain/message.js';

/** Con trỏ đã đọc của một người trong một hội thoại (`messaging.conversation_reads`, BE-S6-04). */
export interface ConversationReadState {
  readonly conversationId: ConversationId;
  readonly userId: ConversationUserId;
  /** Tin mới nhất người này đã đọc (id UUID v7 — mọi tin id ≤ con trỏ coi là đã đọc). */
  readonly lastReadMessageId: MessageId;
  readonly readAt: Date;
}

/** Lưu / đọc con trỏ đã đọc. Mọi thao tác chạy trong `tx` của caller (A5). */
export interface ConversationReadRepository {
  /**
   * Đẩy con trỏ lên `messageId` nếu lớn hơn con trỏ hiện có (chưa có → tạo). Con trỏ **chỉ tiến**, kể cả khi nhiều thiết
   * bị gửi đồng thời (điều kiện so sánh nằm trong câu UPSERT ở DB). Trả trạng thái sau thao tác + `advanced` = con trỏ
   * vừa đổi.
   */
  advance(
    tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly userId: ConversationUserId;
      readonly messageId: MessageId;
      readonly readAt: Date;
    },
  ): Promise<{ readonly state: ConversationReadState; readonly advanced: boolean }>;

  find(
    tx: Tx,
    input: { readonly conversationId: ConversationId; readonly userId: ConversationUserId },
  ): Promise<ConversationReadState | null>;
}
