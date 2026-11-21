import { err, fail, ok, parseId, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { ConversationId, ConversationStatus } from '../domain/conversation.js';
import {
  Message,
  type MessageId,
  type MessageKind,
  type MessageState,
  type SystemMessageCode,
} from '../domain/message.js';
import type { ConversationRepository } from './ports/conversation-repository.js';
import type { MessageRepository } from './ports/message-repository.js';

export type ConversationAccessError = DomainError<'INVALID_ID' | 'NOT_FOUND' | 'NOT_PARTICIPANT'>;

export interface ConversationAccessDeps {
  readonly uow: UnitOfWork;
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
}

export interface JoinConversationCommand {
  readonly conversationId: string;
  /** Người dùng đã xác thực (từ access token). */
  readonly userId: string;
}

export interface JoinedConversationView {
  readonly conversationId: ConversationId;
  readonly status: ConversationStatus;
  readonly closesAt: Date;
}

/**
 * Tham gia phòng realtime của hội thoại (WS `conversation.join`, BE-S6-02): id sai → `INVALID_ID`, không có →
 * `NOT_FOUND`, người ngoài cặp → `NOT_PARTICIPANT`. Hội thoại đã đóng vẫn tham gia được (xem lại, nhận tin hệ thống);
 * gửi tin vào hội thoại đóng do `SendMessage` chặn.
 */
export class JoinConversation {
  constructor(private readonly deps: ConversationAccessDeps) {}

  async execute(
    cmd: JoinConversationCommand,
  ): Promise<Result<JoinedConversationView, ConversationAccessError>> {
    const id = parseId<'Conversation'>(cmd.conversationId);
    if (id.isErr()) return err(id.error);
    return this.deps.uow.run(async (tx): Promise<Result<JoinedConversationView, ConversationAccessError>> => {
      const conversation = await this.deps.conversations.findById(tx, id.value);
      if (!conversation) return fail('NOT_FOUND');
      if (!conversation.isParticipant(cmd.userId)) return fail('NOT_PARTICIPANT');
      return ok({
        conversationId: conversation.id,
        status: conversation.status,
        closesAt: conversation.closesAt,
      });
    });
  }
}

/** Số tin tối đa một lần lấy (client nối lại lấy tin bị lỡ). */
export const MESSAGES_AFTER_MAX_LIMIT = 100;

export interface ListMessagesAfterQuery {
  readonly conversationId: string;
  readonly userId: string;
  /** Id tin (UUID v7) cuối cùng client đã có; bỏ trống = từ tin đầu tiên. */
  readonly after?: string;
  /** 1…`MESSAGES_AFTER_MAX_LIMIT` (ngoài khoảng bị kẹp lại). */
  readonly limit: number;
}

/**
 * Tin nhắn **nhìn từ một người xem**: `body` = `Message.bodyFor(viewer)` (người gửi thấy bản gốc, người khác thấy bản đã
 * che nếu có); `masked` = người xem nhận bản đã che; `clientMessageId` chỉ trả cho chính người gửi.
 */
export interface ConversationMessageView {
  readonly messageId: MessageId;
  readonly conversationId: ConversationId;
  readonly senderId: string | null;
  readonly kind: MessageKind;
  readonly systemCode: SystemMessageCode | null;
  readonly body: string;
  readonly masked: boolean;
  readonly clientMessageId: string | null;
  readonly sentAt: Date;
}

export interface MessagesAfterView {
  readonly items: readonly ConversationMessageView[];
  /** Còn tin sau tin cuối của trang này. */
  readonly hasMore: boolean;
}

export function toConversationMessageView(s: MessageState, viewerId: string): ConversationMessageView {
  const message = Message.restore(s);
  const own = s.senderId !== null && s.senderId === viewerId.toLowerCase();
  return {
    messageId: s.id,
    conversationId: s.conversationId,
    senderId: s.senderId,
    kind: s.kind,
    systemCode: s.systemCode,
    body: message.bodyFor(viewerId),
    masked: !own && s.maskedBody !== null,
    clientMessageId: own ? s.clientMessageId : null,
    sentAt: s.sentAt,
  };
}

/**
 * Tin của hội thoại sau một tin (BE-S6-02, bản tối thiểu cho client nối lại WS lấy tin bị lỡ; BE-S6-04 mở rộng):
 * chỉ người trong cặp (`NOT_FOUND`/`NOT_PARTICIPANT` như `JoinConversation`), `after` phải là UUID v7
 * (`INVALID_ID`), tăng dần theo id, tối đa `limit` tin + cờ `hasMore`. Chỉ tin người xem được thấy (`visible_to` null
 * hoặc = người xem — lọc ở DB, kiểm lại bằng `Message.isVisibleTo`), nội dung theo `Message.bodyFor(viewer)`.
 */
export class ListMessagesAfter {
  constructor(private readonly deps: ConversationAccessDeps) {}

  async execute(query: ListMessagesAfterQuery): Promise<Result<MessagesAfterView, ConversationAccessError>> {
    const id = parseId<'Conversation'>(query.conversationId);
    if (id.isErr()) return err(id.error);
    let afterId: MessageId | null = null;
    if (query.after !== undefined) {
      const after = parseId<'Message'>(query.after);
      if (after.isErr()) return err(after.error);
      afterId = after.value;
    }
    const limit = Math.min(Math.max(Math.trunc(query.limit), 1), MESSAGES_AFTER_MAX_LIMIT);

    return this.deps.uow.run(async (tx): Promise<Result<MessagesAfterView, ConversationAccessError>> => {
      const conversation = await this.deps.conversations.findById(tx, id.value);
      if (!conversation) return fail('NOT_FOUND');
      if (!conversation.isParticipant(query.userId)) return fail('NOT_PARTICIPANT');
      const rows = await this.deps.messages.listAfter(tx, {
        conversationId: conversation.id,
        viewerId: query.userId,
        afterId,
        limit: limit + 1,
      });
      const items = rows
        .slice(0, limit)
        .filter((s) => Message.restore(s).isVisibleTo(query.userId))
        .map((s) => toConversationMessageView(s, query.userId));
      return ok({ items, hasMore: rows.length > limit });
    });
  }
}
