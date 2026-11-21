/**
 * Event payload của module messaging (phát qua outbox, BE-S6-01). **Không chứa nội dung tin nhắn** (PII, Nghị định
 * 13/2023): chỉ id, loại, cờ, mã phân loại. Thời gian dạng ISO 8601 UTC.
 */

export const CONVERSATION_STATUS_NAMES = ['OPEN', 'CLOSED'] as const;
export type ConversationStatusName = (typeof CONVERSATION_STATUS_NAMES)[number];

/** Lý do đóng hội thoại: match rời `DATING`/`MET` sang trạng thái đóng (`MatchClosed`) hoặc bị khoá (`MatchLocked`). */
export const CONVERSATION_CLOSE_REASON_NAMES = ['MATCH_CLOSED', 'MATCH_LOCKED'] as const;
export type ConversationCloseReasonName = (typeof CONVERSATION_CLOSE_REASON_NAMES)[number];

export const MESSAGE_KIND_NAMES = ['TEXT', 'IMAGE', 'SYSTEM'] as const;
export type MessageKindName = (typeof MESSAGE_KIND_NAMES)[number];

/** Mã tin hệ thống (FE có thể tự dịch; `body` của tin hệ thống là câu tiếng Việt mặc định). */
/**
 * `FRAUD_WARNING` (BE-S6-03): cảnh báo lừa đảo chỉ người nhận tin bị gắn cờ thấy — `MessageSent.recipientIds` chỉ có
 * người đó.
 */
export const SYSTEM_MESSAGE_CODE_NAMES = [
  'CONVERSATION_OPENED',
  'CONVERSATION_CLOSED',
  'FRAUD_WARNING',
] as const;
export type SystemMessageCodeName = (typeof SYSTEM_MESSAGE_CODE_NAMES)[number];

/** Match vào `DATING` → mở hội thoại. `closesAt` = hết giai đoạn tìm hiểu (`expiresAt` của `MatchStartedDating`). */
export const CONVERSATION_OPENED = 'ConversationOpened';
export interface ConversationOpenedPayload {
  readonly conversationId: string;
  readonly matchId: string;
  readonly participantIds: readonly string[];
  readonly closesAt: string;
}

/** Hội thoại đóng theo match (không nhận tin nữa). */
export const CONVERSATION_CLOSED = 'ConversationClosed';
export interface ConversationClosedPayload {
  readonly conversationId: string;
  readonly matchId: string;
  readonly participantIds: readonly string[];
  readonly reason: ConversationCloseReasonName;
}

/**
 * Có tin mới trong hội thoại (kể cả tin hệ thống: `senderId = null`, `systemCode` khác null). `recipientIds` = những
 * người tham gia khác người gửi (tin hệ thống: cả hai). `flagged` = tin bị bộ lọc gắn cờ (BE-S6-03).
 */
export const MESSAGE_SENT = 'MessageSent';
export interface MessageSentPayload {
  readonly messageId: string;
  readonly conversationId: string;
  readonly senderId: string | null;
  readonly recipientIds: readonly string[];
  readonly kind: MessageKindName;
  readonly systemCode: SystemMessageCodeName | null;
  readonly flagged: boolean;
  readonly sentAt: string;
}

/** Tin bị bộ lọc lừa đảo gắn cờ → hàng chờ kiểm duyệt. `reasons` là mã luật (không trích nội dung tin). */
export const MESSAGE_FLAGGED = 'MessageFlagged';
export interface MessageFlaggedPayload {
  readonly messageId: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly reasons: readonly string[];
}
