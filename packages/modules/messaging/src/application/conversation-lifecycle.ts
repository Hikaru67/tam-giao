import { newId, type Clock, type Tx } from '@tamgiao/kernel';
import {
  Conversation,
  type ConversationCloseReason,
  type ConversationMatchId,
  type ConversationUserId,
} from '../domain/conversation.js';
import { Message } from '../domain/message.js';
import type { ConversationRepository } from './ports/conversation-repository.js';
import type { MessageRepository } from './ports/message-repository.js';

export interface ConversationLifecycleDeps {
  readonly clock: Clock;
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
}

export interface OpenConversationInput {
  readonly matchId: ConversationMatchId;
  readonly participantIds: readonly [ConversationUserId, ConversationUserId];
  /** Lúc match vào `DATING` (`occurredAt` của event). */
  readonly openedAt: Date;
  /** Hết giai đoạn tìm hiểu (`expiresAt` của `MatchStartedDating`). */
  readonly closesAt: Date;
}

export type OpenConversationOutcome = 'OPENED' | 'ALREADY_EXISTS';

/**
 * Handler `MatchStartedDating` → mở hội thoại + tin hệ thống mở đầu (BE-S6-01). Chạy trong `tx` của consumer
 * (`deliverOnce` đã chống xử lý trùng bằng `processed_events`); bản thân handler cũng idempotent (A9): match đã có
 * hội thoại → `ALREADY_EXISTS`, không ghi gì. Unique `match_id` ở DB chặn trường hợp hai lượt chạy đồng thời (A10).
 */
export class OpenConversationForMatch {
  constructor(private readonly deps: ConversationLifecycleDeps) {}

  async handle(tx: Tx, input: OpenConversationInput): Promise<OpenConversationOutcome> {
    const existing = await this.deps.conversations.findByMatchIdForUpdate(tx, input.matchId);
    if (existing) return 'ALREADY_EXISTS';
    const now = this.deps.clock.now();
    const conversation = Conversation.open(
      {
        id: newId<'Conversation'>(),
        matchId: input.matchId,
        participants: input.participantIds,
        openedAt: input.openedAt,
        closesAt: input.closesAt,
      },
      now,
    );
    const greeting = Message.system(
      conversation,
      { id: newId<'Message'>(), code: 'CONVERSATION_OPENED' },
      now,
    );
    await this.deps.conversations.save(tx, conversation);
    await this.deps.messages.save(tx, greeting);
    return 'OPENED';
  }
}

export type CloseConversationOutcome =
  'CLOSED' | 'ALREADY_CLOSED' | 'CLOSED_BEFORE_OPENING' | 'NO_CONVERSATION';

/** Trạng thái match mà từ đó hội thoại đã (hoặc lẽ ra đã) được mở: `DATING` và `MET` (sau buổi gặp, chờ feedback). */
const STATUSES_WITH_CONVERSATION: readonly string[] = ['DATING', 'MET'];

export interface CloseConversationInput {
  readonly matchId: ConversationMatchId;
  readonly participantIds: readonly [ConversationUserId, ConversationUserId];
  /** Trạng thái match trước khi đóng/khoá (`fromStatus` của event). */
  readonly fromStatus: string;
  readonly reason: ConversationCloseReason;
  /** Lúc match đóng/khoá (`occurredAt` của event). */
  readonly closedAt: Date;
}

/**
 * Handler `MatchClosed` / `MatchLocked` → đóng hội thoại + tin hệ thống "đã đóng" (BE-S6-01). Idempotent (A9):
 * hội thoại đã đóng → `ALREADY_CLOSED`. Khoá `FOR UPDATE` cùng dòng với `SendMessage` nên không tin nào lọt vào sau
 * khi đóng. Không có hội thoại:
 * - match đóng từ `DATING`/`MET` → event mở chưa được xử lý (hai consumer chạy độc lập) → tạo sẵn hội thoại `CLOSED`
 *   (`CLOSED_BEFORE_OPENING`) để handler mở chạy sau không mở lại kênh chat;
 * - match chưa từng vào `DATING` (vd khoá khi `OFFERED`) → `NO_CONVERSATION`, không ghi gì.
 */
export class CloseConversationForMatch {
  constructor(private readonly deps: ConversationLifecycleDeps) {}

  async handle(tx: Tx, input: CloseConversationInput): Promise<CloseConversationOutcome> {
    const conversation = await this.deps.conversations.findByMatchIdForUpdate(tx, input.matchId);
    const now = this.deps.clock.now();
    if (!conversation) {
      if (!STATUSES_WITH_CONVERSATION.includes(input.fromStatus)) return 'NO_CONVERSATION';
      const tombstone = Conversation.closedBeforeOpening(
        {
          id: newId<'Conversation'>(),
          matchId: input.matchId,
          participants: input.participantIds,
          reason: input.reason,
          closedAt: input.closedAt,
        },
        now,
      );
      await this.deps.conversations.save(tx, tombstone);
      return 'CLOSED_BEFORE_OPENING';
    }
    if (!conversation.close(input.reason, now)) return 'ALREADY_CLOSED';
    const notice = Message.system(conversation, { id: newId<'Message'>(), code: 'CONVERSATION_CLOSED' }, now);
    await this.deps.conversations.save(tx, conversation);
    await this.deps.messages.save(tx, notice);
    return 'CLOSED';
  }
}
