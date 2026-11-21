import type { ConversationMessageDto, ConversationSummaryDto } from '@tamgiao/contracts';
import type { ConversationMessageView } from '../application/conversation-access.js';
import type { ConversationReadView, ConversationSummaryView } from '../application/conversation-inbox.js';
import type { ConversationBroadcast, RealtimeMessage } from '../application/ports/message-broadcaster.js';
import type { SentMessageView, SentSystemMessageView } from '../application/send-message.js';

/** Tin vừa gửi (view của `SendMessage`) → bản đẩy realtime (mang cả `body` và `maskedBody`). */
export const realtimeFromSent = (v: SentMessageView): RealtimeMessage => ({
  messageId: v.messageId,
  conversationId: v.conversationId,
  senderId: v.senderId,
  kind: v.kind,
  systemCode: null,
  body: v.body,
  maskedBody: v.maskedBody,
  clientMessageId: v.clientMessageId,
  visibleTo: null,
  sentAt: v.sentAt.toISOString(),
});

/** Tin hệ thống tạo kèm khi gửi (vd `FRAUD_WARNING`) → bản đẩy realtime. */
export const realtimeFromSystem = (v: SentSystemMessageView): RealtimeMessage => ({
  messageId: v.messageId,
  conversationId: v.conversationId,
  senderId: null,
  kind: 'SYSTEM',
  systemCode: v.systemCode,
  body: v.body,
  maskedBody: null,
  clientMessageId: null,
  visibleTo: v.visibleTo,
  sentAt: v.sentAt.toISOString(),
});

/** Tin lịch sử (đã chọn theo người xem ở application) → DTO. */
export const historyToDto = (v: ConversationMessageView): ConversationMessageDto => ({
  messageId: v.messageId,
  conversationId: v.conversationId,
  senderId: v.senderId,
  kind: v.kind,
  systemCode: v.systemCode,
  body: v.body,
  masked: v.masked,
  clientMessageId: v.clientMessageId,
  sentAt: v.sentAt.toISOString(),
});

/** Hộp thư (view application) → DTO. */
export const summaryToDto = (v: ConversationSummaryView): ConversationSummaryDto => ({
  conversationId: v.conversationId,
  peerUserId: v.peerUserId,
  status: v.status,
  openedAt: v.openedAt.toISOString(),
  closesAt: v.closesAt.toISOString(),
  datingDay: v.datingDay,
  datingDays: v.datingDays,
  lastMessage: v.lastMessage ? historyToDto(v.lastMessage) : null,
  unreadCount: v.unreadCount,
  lastReadMessageId: v.lastReadMessageId,
});

/** Con trỏ đã đọc vừa tiến → sự kiện realtime `message.read` cho phòng (REST: `originConnectionId = null`). */
export const readBroadcast = (
  v: ConversationReadView,
  originConnectionId: string | null,
): ConversationBroadcast => ({
  type: 'message.read',
  conversationId: v.conversationId,
  originConnectionId,
  readerId: v.readerId,
  messageId: v.lastReadMessageId,
  readAt: v.readAt.toISOString(),
});

/**
 * Bản realtime (đã tuần tự hoá qua Redis) → DTO cho một người xem — cùng luật `Message.bodyFor` của domain (có test
 * đối chiếu): người gửi thấy `body` gốc của mình (+ `clientMessageId` để khớp tin đang chờ); người
 * khác thấy `maskedBody ?? body` (`masked = true` khi có phần bị che) và không thấy `clientMessageId`.
 */
export function toMessageDto(m: RealtimeMessage, viewerId: string): ConversationMessageDto {
  const own = m.senderId !== null && m.senderId === viewerId.toLowerCase();
  const masked = !own && m.maskedBody !== null;
  return {
    messageId: m.messageId,
    conversationId: m.conversationId,
    senderId: m.senderId,
    kind: m.kind,
    systemCode: m.systemCode,
    body: masked && m.maskedBody !== null ? m.maskedBody : m.body,
    masked,
    clientMessageId: own ? m.clientMessageId : null,
    sentAt: m.sentAt,
  };
}
