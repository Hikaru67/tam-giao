import { DATING_DAYS } from '@tamgiao/contracts/constants';
import { err, fail, ok, parseId, type Clock, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type {
  Conversation,
  ConversationId,
  ConversationStatus,
  ConversationUserId,
} from '../domain/conversation.js';
import { icebreakersForDay } from '../domain/icebreakers.js';
import { Message, type MessageId } from '../domain/message.js';
import {
  toConversationMessageView,
  type ConversationAccessError,
  type ConversationMessageView,
} from './conversation-access.js';
import type { ConversationReadRepository } from './ports/conversation-read-repository.js';
import type { ConversationRepository } from './ports/conversation-repository.js';
import type { MessageRepository } from './ports/message-repository.js';

export interface ConversationInboxDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly reads: ConversationReadRepository;
}

/** Một dòng hộp thư (màn 10) nhìn từ một người xem. */
export interface ConversationSummaryView {
  readonly conversationId: ConversationId;
  /** Người còn lại trong cặp (FE tra hồ sơ hiển thị qua API profile). */
  readonly peerUserId: ConversationUserId;
  readonly status: ConversationStatus;
  readonly openedAt: Date;
  readonly closesAt: Date;
  /** Ngày X của giai đoạn tìm hiểu (1…`datingDays`), dừng tăng khi hội thoại đóng / hết hạn. */
  readonly datingDay: number;
  readonly datingDays: number;
  /** Tin mới nhất người xem được thấy (nội dung theo `bodyFor(viewer)`); `null` khi chưa có tin nào. */
  readonly lastMessage: ConversationMessageView | null;
  readonly unreadCount: number;
  readonly lastReadMessageId: MessageId | null;
}

/**
 * Hộp thư của người dùng (BE-S6-04, `GET /me/conversations`): mọi hội thoại (mở + đã đóng, để xem lại) của người xem,
 * mỗi dòng có tin cuối (đã chọn theo người xem — tôn trọng `maskedBody`/`visible_to`), số chưa đọc (sau con trỏ
 * `last_read_message_id`), tiến trình ngày X/`DATING_DAYS`. Sắp xếp: hội thoại có tin mới nhất trước (theo id tin UUID
 * v7), chưa có tin thì theo `openedAt`. Không phân trang: luật độc quyền 1-1 khiến mỗi người chỉ có vài hội thoại.
 */
export class ListMyConversations {
  constructor(private readonly deps: ConversationInboxDeps) {}

  async execute(query: {
    readonly userId: string;
  }): Promise<Result<readonly ConversationSummaryView[], never>> {
    const viewerId = query.userId.toLowerCase();
    const now = this.deps.clock.now();
    return this.deps.uow.run(async (tx): Promise<Result<readonly ConversationSummaryView[], never>> => {
      const conversations = await this.deps.conversations.listByParticipant(tx, viewerId);
      const items: ConversationSummaryView[] = [];
      for (const conversation of conversations) {
        const [latest] = await this.deps.messages.listBefore(tx, {
          conversationId: conversation.id,
          viewerId,
          beforeId: null,
          limit: 1,
        });
        const read = await this.deps.reads.find(tx, { conversationId: conversation.id, userId: viewerId });
        const lastReadMessageId = read?.lastReadMessageId ?? null;
        const unreadCount = await this.deps.messages.countUnread(tx, {
          conversationId: conversation.id,
          viewerId,
          afterId: lastReadMessageId,
        });
        items.push({
          conversationId: conversation.id,
          peerUserId: peerOf(conversation, viewerId),
          status: conversation.status,
          openedAt: conversation.openedAt,
          closesAt: conversation.closesAt,
          datingDay: conversation.datingDay(now),
          datingDays: DATING_DAYS,
          lastMessage:
            latest && Message.restore(latest).isVisibleTo(viewerId)
              ? toConversationMessageView(latest, viewerId)
              : null,
          unreadCount,
          lastReadMessageId,
        });
      }
      items.sort((x, y) => activityKey(y).localeCompare(activityKey(x)));
      return ok(items);
    });
  }
}

/** Khoá sắp xếp "hoạt động gần nhất": id tin cuối (UUID v7 ~ thời gian) hoặc thời điểm mở. */
function activityKey(v: ConversationSummaryView): string {
  return v.lastMessage
    ? v.lastMessage.sentAt.toISOString() + v.lastMessage.messageId
    : v.openedAt.toISOString();
}

function peerOf(conversation: Conversation, viewerId: string): ConversationUserId {
  const peer = conversation.peerOf(viewerId);
  if (peer === null) throw new Error(`listByParticipant trả hội thoại ${conversation.id} không có người xem`);
  return peer;
}

export interface MarkConversationReadCommand {
  readonly conversationId: string;
  readonly userId: string;
  /** Tin mới nhất người dùng đã đọc (phải thuộc hội thoại và người dùng được thấy). */
  readonly messageId: string;
}

export interface ConversationReadView {
  readonly conversationId: ConversationId;
  readonly readerId: ConversationUserId;
  /** Con trỏ sau thao tác (có thể lớn hơn `messageId` gửi lên nếu thiết bị khác đã đánh dấu xa hơn). */
  readonly lastReadMessageId: MessageId;
  readonly readAt: Date;
  /** `true` = con trỏ vừa tiến (nên phát `message.read` realtime); `false` = đánh dấu tin cũ hơn, không đổi gì. */
  readonly advanced: boolean;
  readonly unreadCount: number;
}

/**
 * Đánh dấu đã đọc tới một tin (BE-S6-04): `POST /me/conversations/:id/read` và WS `message.read` gọi chung use case
 * này. Id sai → `INVALID_ID`; hội thoại không có → `NOT_FOUND`; người ngoài → `NOT_PARTICIPANT`; tin không thuộc hội
 * thoại / người xem không được thấy → `NOT_FOUND` (`meta.field = messageId`). Con trỏ chỉ tiến (lưu ở
 * `messaging.conversation_reads`). Hội thoại đã đóng vẫn đánh dấu được (xem lại lịch sử).
 */
export class MarkConversationRead {
  constructor(private readonly deps: ConversationInboxDeps) {}

  async execute(
    cmd: MarkConversationReadCommand,
  ): Promise<Result<ConversationReadView, ConversationAccessError>> {
    const id = parseId<'Conversation'>(cmd.conversationId);
    if (id.isErr()) return err(id.error);
    const messageId = parseId<'Message'>(cmd.messageId);
    if (messageId.isErr()) return err(messageId.error);
    const readerId = cmd.userId.toLowerCase();
    const now = this.deps.clock.now();

    return this.deps.uow.run(async (tx): Promise<Result<ConversationReadView, ConversationAccessError>> => {
      const conversation = await this.deps.conversations.findById(tx, id.value);
      if (!conversation) return fail('NOT_FOUND');
      if (!conversation.isParticipant(readerId)) return fail('NOT_PARTICIPANT');
      const message = await this.deps.messages.findById(tx, messageId.value);
      if (
        !message ||
        message.conversationId !== conversation.id ||
        !Message.restore(message).isVisibleTo(readerId)
      ) {
        return fail('NOT_FOUND', { field: 'messageId' });
      }
      const { state, advanced } = await this.deps.reads.advance(tx, {
        conversationId: conversation.id,
        userId: readerId,
        messageId: message.id,
        readAt: now,
      });
      const unreadCount = await this.deps.messages.countUnread(tx, {
        conversationId: conversation.id,
        viewerId: readerId,
        afterId: state.lastReadMessageId,
      });
      return ok({
        conversationId: conversation.id,
        readerId,
        lastReadMessageId: state.lastReadMessageId,
        readAt: state.readAt,
        advanced,
        unreadCount,
      });
    });
  }
}

export interface IcebreakersView {
  readonly conversationId: ConversationId;
  readonly datingDay: number;
  readonly datingDays: number;
  readonly theme: string;
  readonly topics: readonly string[];
}

/**
 * Gợi ý phá băng của hội thoại theo ngày tìm hiểu hiện tại (BE-S6-04, `GET /me/conversations/:id/icebreakers`): danh
 * sách tĩnh `ICEBREAKER_STAGES` ở domain. Chỉ participant (`NOT_FOUND`/`NOT_PARTICIPANT`/`INVALID_ID`).
 */
export class GetIcebreakers {
  constructor(private readonly deps: Pick<ConversationInboxDeps, 'uow' | 'clock' | 'conversations'>) {}

  async execute(query: {
    readonly conversationId: string;
    readonly userId: string;
  }): Promise<Result<IcebreakersView, ConversationAccessError>> {
    const id = parseId<'Conversation'>(query.conversationId);
    if (id.isErr()) return err(id.error);
    const now = this.deps.clock.now();
    return this.deps.uow.run(async (tx): Promise<Result<IcebreakersView, ConversationAccessError>> => {
      const conversation = await this.deps.conversations.findById(tx, id.value);
      if (!conversation) return fail('NOT_FOUND');
      if (!conversation.isParticipant(query.userId)) return fail('NOT_PARTICIPANT');
      const datingDay = conversation.datingDay(now);
      const stage = icebreakersForDay(datingDay);
      return ok({
        conversationId: conversation.id,
        datingDay,
        datingDays: DATING_DAYS,
        theme: stage.theme,
        topics: stage.topics,
      });
    });
  }
}
