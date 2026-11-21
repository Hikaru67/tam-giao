import { DATING_DAYS } from '@tamgiao/contracts/constants';
import { AggregateRoot, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';
import { CONVERSATION_CLOSED, CONVERSATION_OPENED } from './messaging-events.js';

export type ConversationId = Id<'Conversation'>;
/** Id tài khoản app (module identity) — messaging chỉ giữ tham chiếu (A3). */
export type ConversationUserId = string;
/** Id match (module matching) — messaging chỉ giữ tham chiếu, nhận qua event. */
export type ConversationMatchId = string;

const DAY_MS = 24 * 60 * 60 * 1000;

export const CONVERSATION_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Lý do đóng: match đóng (`MatchClosed`) | match bị khoá (`MatchLocked`, vd báo cáo vi phạm). */
export const CONVERSATION_CLOSE_REASONS = ['MATCH_CLOSED', 'MATCH_LOCKED'] as const;
export type ConversationCloseReason = (typeof CONVERSATION_CLOSE_REASONS)[number];

export type ConversationSendError = DomainError<'NOT_PARTICIPANT' | 'CONVERSATION_CLOSED'>;

/** Snapshot đầy đủ để repository lưu / dựng lại aggregate (`toState` ↔ `restore`). */
export interface ConversationState {
  readonly id: ConversationId;
  /** Match nguồn — mỗi match tối đa một hội thoại (unique ở DB, A10). */
  readonly matchId: ConversationMatchId;
  /** Hai người trong cặp (id chữ thường), giữ đúng thứ tự trong event `MatchStartedDating`. */
  readonly participants: readonly [ConversationUserId, ConversationUserId];
  readonly status: ConversationStatus;
  /** Lúc match vào `DATING` (`occurredAt` của `MatchStartedDating`). */
  readonly openedAt: Date;
  /** Hết giai đoạn tìm hiểu (`expiresAt` của `MatchStartedDating` = `DATING_DAYS`); từ mốc này không nhận tin. */
  readonly closesAt: Date;
  readonly closedAt: Date | null;
  readonly closeReason: ConversationCloseReason | null;
  readonly updatedAt: Date;
  readonly version: number;
}

type MutableState = Omit<ConversationState, 'version'>;

/**
 * Aggregate `Conversation` — kênh chat của một match, chỉ tồn tại trong giai đoạn `DATING` (nguyên tắc "một người
 * thật, một lúc").
 *
 * - `open` (handler `MatchStartedDating`) → `OPEN`, phát `ConversationOpened`.
 * - `close(reason)` (handler `MatchClosed` / `MatchLocked`) → `CLOSED`, phát `ConversationClosed`; đã đóng → no-op
 *   `false` (idempotent, không event, không tăng version).
 * - `closedBeforeOpening` (event đóng/khoá tới trước event mở) → tạo thẳng `CLOSED`, phát `ConversationClosed`.
 * - `ensureCanSend(senderId, now)`: người ngoài cặp → `NOT_PARTICIPANT` (kiểm tra trước, không lộ trạng thái cho người
 *   ngoài) → `CLOSED` → `CONVERSATION_CLOSED{reason: CLOSED}` → `now >= closesAt` (đã hết `DATING_DAYS` nhưng event
 *   đóng match chưa tới) → `CONVERSATION_CLOSED{reason: PERIOD_ENDED}`.
 *
 * Tin nhắn là aggregate riêng (`Message`) — không nạp cả lịch sử chat vào hội thoại.
 */
export class Conversation extends AggregateRoot<ConversationId> {
  protected readonly aggregateType = 'Conversation';

  private constructor(
    private state: MutableState,
    version: number,
  ) {
    super(state.id, version);
  }

  /** Mở hội thoại cho match vừa vào `DATING`. Hai người phải khác nhau, `closesAt > openedAt` (sai → lỗi lập trình). */
  static open(
    input: {
      readonly id: ConversationId;
      readonly matchId: ConversationMatchId;
      readonly participants: readonly [ConversationUserId, ConversationUserId];
      readonly openedAt: Date;
      readonly closesAt: Date;
    },
    now: Date,
  ): Conversation {
    const participants = [input.participants[0].toLowerCase(), input.participants[1].toLowerCase()] as const;
    if (participants[0] === participants[1]) throw new Error('Conversation cần hai người khác nhau');
    if (input.closesAt.getTime() <= input.openedAt.getTime()) {
      throw new Error('Conversation: closesAt phải sau openedAt');
    }
    const conversation = new Conversation(
      {
        id: input.id,
        matchId: input.matchId.toLowerCase(),
        participants,
        status: 'OPEN',
        openedAt: new Date(input.openedAt.getTime()),
        closesAt: new Date(input.closesAt.getTime()),
        closedAt: null,
        closeReason: null,
        updatedAt: new Date(now.getTime()),
      },
      0,
    );
    conversation.record(
      CONVERSATION_OPENED,
      {
        conversationId: input.id,
        matchId: conversation.state.matchId,
        participantIds: [...participants],
        closesAt: conversation.state.closesAt.toISOString(),
      },
      now,
    );
    return conversation;
  }

  /**
   * Event đóng/khoá match tới **trước** event mở (`MatchStartedDating`) — mỗi consumer một hàng đợi riêng nên thứ tự
   * xử lý giữa hai consumer không được bảo đảm. Tạo sẵn hội thoại ở trạng thái `CLOSED` (`openedAt = closesAt =
   * closedAt = lúc đóng`) để handler mở chạy sau thấy "đã có" và không mở lại kênh chat cho match đã đóng/khoá.
   * Phát `ConversationClosed` (không phát `ConversationOpened`).
   */
  static closedBeforeOpening(
    input: {
      readonly id: ConversationId;
      readonly matchId: ConversationMatchId;
      readonly participants: readonly [ConversationUserId, ConversationUserId];
      readonly reason: ConversationCloseReason;
      readonly closedAt: Date;
    },
    now: Date,
  ): Conversation {
    const participants = [input.participants[0].toLowerCase(), input.participants[1].toLowerCase()] as const;
    if (participants[0] === participants[1]) throw new Error('Conversation cần hai người khác nhau');
    const at = new Date(input.closedAt.getTime());
    const conversation = new Conversation(
      {
        id: input.id,
        matchId: input.matchId.toLowerCase(),
        participants,
        status: 'CLOSED',
        openedAt: at,
        closesAt: at,
        closedAt: at,
        closeReason: input.reason,
        updatedAt: new Date(now.getTime()),
      },
      0,
    );
    conversation.recordClosed(now);
    return conversation;
  }

  static restore(state: ConversationState): Conversation {
    const { version, ...rest } = state;
    return new Conversation(rest, version);
  }

  get matchId(): ConversationMatchId {
    return this.state.matchId;
  }

  get participants(): readonly [ConversationUserId, ConversationUserId] {
    return this.state.participants;
  }

  get status(): ConversationStatus {
    return this.state.status;
  }

  get closesAt(): Date {
    return new Date(this.state.closesAt.getTime());
  }

  get openedAt(): Date {
    return new Date(this.state.openedAt.getTime());
  }

  /** Người còn lại trong cặp của `userId`; `null` khi `userId` không phải participant. */
  peerOf(userId: ConversationUserId): ConversationUserId | null {
    if (!this.isParticipant(userId)) return null;
    const id = userId.toLowerCase();
    return this.state.participants.find((p) => p !== id) ?? null;
  }

  /**
   * Ngày thứ mấy của giai đoạn tìm hiểu lúc `now` (BE-S6-04, "ngày X/`DATING_DAYS`"): ngày 1 = 24 giờ đầu kể từ
   * `openedAt`. Mốc tính dừng ở `closesAt` hoặc `closedAt` (hội thoại đã đóng không tăng ngày nữa); kết quả kẹp trong
   * 1…`DATING_DAYS`.
   */
  datingDay(now: Date): number {
    const stops = [now.getTime(), this.state.closesAt.getTime()];
    if (this.state.closedAt !== null) stops.push(this.state.closedAt.getTime());
    const elapsed = Math.min(...stops) - this.state.openedAt.getTime();
    const day = Math.floor(elapsed / DAY_MS) + 1;
    return Math.min(Math.max(day, 1), DATING_DAYS);
  }

  isParticipant(userId: ConversationUserId): boolean {
    const id = userId.toLowerCase();
    return this.state.participants.includes(id);
  }

  /** Những người nhận tin của `senderId` (người còn lại); tin hệ thống (`null`) → cả hai. */
  recipientsOf(senderId: ConversationUserId | null): readonly ConversationUserId[] {
    if (senderId === null) return [...this.state.participants];
    const id = senderId.toLowerCase();
    return this.state.participants.filter((p) => p !== id);
  }

  /** Kiểm tra `senderId` được gửi tin lúc `now` (xem thứ tự ở mô tả class). */
  ensureCanSend(senderId: ConversationUserId, now: Date): Result<void, ConversationSendError> {
    if (!this.isParticipant(senderId)) return fail('NOT_PARTICIPANT');
    if (this.state.status === 'CLOSED') return fail('CONVERSATION_CLOSED', { reason: 'CLOSED' });
    if (now.getTime() >= this.state.closesAt.getTime()) {
      return fail('CONVERSATION_CLOSED', { reason: 'PERIOD_ENDED' });
    }
    return ok();
  }

  /** Đóng hội thoại theo match. Trả `true` khi vừa đóng, `false` khi đã đóng từ trước (no-op). */
  close(reason: ConversationCloseReason, now: Date): boolean {
    if (this.state.status === 'CLOSED') return false;
    this.state = {
      ...this.state,
      status: 'CLOSED',
      closedAt: new Date(now.getTime()),
      closeReason: reason,
      updatedAt: new Date(now.getTime()),
    };
    this.recordClosed(now);
    return true;
  }

  toState(): ConversationState {
    return { ...this.state, version: this.version };
  }

  private recordClosed(now: Date): void {
    this.record(
      CONVERSATION_CLOSED,
      {
        conversationId: this.id,
        matchId: this.state.matchId,
        participantIds: [...this.state.participants],
        reason: this.state.closeReason,
      },
      now,
    );
  }
}
