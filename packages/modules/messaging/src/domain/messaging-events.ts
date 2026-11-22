/**
 * Tên event + enum của module messaging. Domain không được import contracts ngoài `constants` (A1) nên giữ bản sao ở
 * đây; test `messaging-contracts.test.ts` bảo đảm khớp với `@tamgiao/contracts` (`messaging/events.ts`), nơi khai báo
 * payload. Payload không bao giờ chứa nội dung tin nhắn (PII).
 */
export const CONVERSATION_OPENED = 'ConversationOpened';
export const CONVERSATION_CLOSED = 'ConversationClosed';
export const MESSAGE_SENT = 'MessageSent';
export const MESSAGE_FLAGGED = 'MessageFlagged';

export const MESSAGING_EVENT_TYPES = [
  CONVERSATION_OPENED,
  CONVERSATION_CLOSED,
  MESSAGE_SENT,
  MESSAGE_FLAGGED,
] as const;
export type MessagingEventType = (typeof MESSAGING_EVENT_TYPES)[number];
