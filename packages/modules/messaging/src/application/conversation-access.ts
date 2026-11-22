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

/** Số tin tối đa một lần lấy (lấy bù khi nối lại / một trang lịch sử). */
export const MESSAGES_MAX_LIMIT = 100;

export type ListMessagesError = ConversationAccessError | DomainError<'VALIDATION_FAILED'>;

export interface ListMessagesQuery {
  readonly conversationId: string;
  readonly userId: string;
  /** Lấy **tới**: các tin có id (UUID v7) > `after` — client nối lại lấy tin bị lỡ. */
  readonly after?: string;
  /** Lấy **lùi**: các tin có id < `before` — cuộn lên xem lịch sử cũ hơn. Không dùng chung với `after`. */
  readonly before?: string;
  /** 1…`MESSAGES_MAX_LIMIT` (ngoài khoảng bị kẹp lại). */
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

export interface MessagesPageView {
  /** Luôn **tăng dần** theo id (cũ → mới), ở cả ba chế độ. */
  readonly items: readonly ConversationMessageView[];
  /** Chế độ `after`: còn tin mới hơn tin cuối trang. Chế độ `before`/mặc định: còn tin cũ hơn tin đầu trang. */
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
 * Trang tin nhắn của hội thoại (BE-S6-02 tạo bản `after`, BE-S6-04 thêm phân trang lùi). Chỉ người trong cặp
 * (`NOT_FOUND`/`NOT_PARTICIPANT` như `JoinConversation`); con trỏ phải là UUID v7 (`INVALID_ID`); `after` và `before`
 * cùng lúc → `VALIDATION_FAILED`. Ba chế độ, trang luôn trả tăng dần + cờ `hasMore`:
 * - `after`: các tin id > `after` (tối đa `limit`, cũ nhất trước) — lấy bù khi nối lại WS.
 * - `before`: `limit` tin ngay trước `before` — cuộn lên; trang kế tiếp dùng `before` = `messageId` đầu trang.
 * - không con trỏ: `limit` tin mới nhất (mở màn chat).
 *
 * Con trỏ là id tin (UUID v7, tăng theo thời gian) chứ không phải offset → tin mới chen vào giữa hai lần gọi không làm
 * trùng/sót tin ở các trang cũ (AC1). Chỉ tin người xem được thấy (`visible_to` null hoặc = người xem — lọc ở DB, kiểm
 * lại bằng `Message.isVisibleTo`), nội dung theo `Message.bodyFor(viewer)`.
 */
export class ListMessages {
  constructor(private readonly deps: ConversationAccessDeps) {}

  async execute(query: ListMessagesQuery): Promise<Result<MessagesPageView, ListMessagesError>> {
    const id = parseId<'Conversation'>(query.conversationId);
    if (id.isErr()) return err(id.error);
    if (query.after !== undefined && query.before !== undefined) {
      return fail('VALIDATION_FAILED', { fields: ['after', 'before'] });
    }
    const cursorRaw = query.after ?? query.before;
    let cursor: MessageId | null = null;
    if (cursorRaw !== undefined) {
      const parsed = parseId<'Message'>(cursorRaw);
      if (parsed.isErr()) return err(parsed.error);
      cursor = parsed.value;
    }
    const limit = Math.min(Math.max(Math.trunc(query.limit), 1), MESSAGES_MAX_LIMIT);
    const forward = query.after !== undefined;

    return this.deps.uow.run(async (tx): Promise<Result<MessagesPageView, ListMessagesError>> => {
      const conversation = await this.deps.conversations.findById(tx, id.value);
      if (!conversation) return fail('NOT_FOUND');
      if (!conversation.isParticipant(query.userId)) return fail('NOT_PARTICIPANT');
      const window = { conversationId: conversation.id, viewerId: query.userId, limit: limit + 1 };
      const rows = forward
        ? await this.deps.messages.listAfter(tx, { ...window, afterId: cursor })
        : await this.deps.messages.listBefore(tx, { ...window, beforeId: cursor });
      const page = rows.slice(0, limit);
      if (!forward) page.reverse();
      const items = page
        .filter((s) => Message.restore(s).isVisibleTo(query.userId))
        .map((s) => toConversationMessageView(s, query.userId));
      return ok({ items, hasMore: rows.length > limit });
    });
  }
}
