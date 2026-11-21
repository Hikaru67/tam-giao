import {
  err,
  fail,
  newId,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { ConversationId, ConversationSendError } from '../domain/conversation.js';
import {
  Message,
  parseClientMessageId,
  type ClientMessageId,
  type MessageId,
  type MessageState,
  type SystemMessageCode,
} from '../domain/message.js';
import {
  PASS_THROUGH_SCREENER,
  checkMessageRateLimit,
  messageRateWindowStart,
  parseMessageBody,
  type MessageBodyError,
  type MessageRateLimitError,
  type MessageScreener,
} from '../domain/message-policy.js';
import type { ConversationRepository } from './ports/conversation-repository.js';
import type { MessageRepository } from './ports/message-repository.js';

export interface SendMessageCommand {
  readonly conversationId: string;
  /** Người dùng đã xác thực (presentation lấy từ token, không nhận từ client). */
  readonly senderId: string;
  readonly body: string;
  /** Idempotency key phía client (UUID). Gửi lại cùng key → trả lại tin cũ (`replayed: true`), không tạo tin mới. */
  readonly clientMessageId?: string;
}

/** Tin vừa gửi, nhìn từ phía người gửi (thấy nội dung gốc của chính mình + bản đã che nếu có). */
export interface SentMessageView {
  readonly messageId: MessageId;
  readonly conversationId: ConversationId;
  readonly senderId: string;
  readonly kind: 'TEXT';
  readonly body: string;
  readonly maskedBody: string | null;
  readonly flagged: boolean;
  readonly clientMessageId: ClientMessageId | null;
  readonly sentAt: Date;
  /** `true` khi đây là tin đã gửi trước đó với cùng `clientMessageId` (client gửi lại). */
  readonly replayed: boolean;
  /**
   * Tin hệ thống tạo kèm trong cùng transaction (BE-S6-03: `FRAUD_WARNING` chỉ người nhận thấy) để transport đẩy
   * realtime. Rỗng khi `replayed` (gửi lại không tạo lại cảnh báo).
   */
  readonly systemMessages: readonly SentSystemMessageView[];
}

export interface SentSystemMessageView {
  readonly messageId: MessageId;
  readonly conversationId: ConversationId;
  readonly systemCode: SystemMessageCode;
  readonly body: string;
  /** Chỉ người này thấy; `null` = cả hai. */
  readonly visibleTo: string | null;
  readonly sentAt: Date;
}

export type SendMessageError =
  | DomainError<'INVALID_ID' | 'NOT_FOUND' | 'CLIENT_MESSAGE_ID_CONFLICT'>
  | MessageBodyError
  | ConversationSendError
  | MessageRateLimitError;

export interface SendMessageDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  /** Sàng lọc nội dung (BE-S6-03: lọc lừa đảo + che liên hệ). Mặc định không lọc. */
  readonly screener?: MessageScreener;
}

/**
 * Gửi tin vào hội thoại (BE-S6-01). Thứ tự:
 * 1. Nội dung (thuần, không chạm DB): rỗng → `MESSAGE_EMPTY`, quá dài → `MESSAGE_TOO_LONG`.
 * 2. Id hội thoại không phải UUID v7 → `INVALID_ID`.
 * 3. **Một transaction**: khoá hội thoại `FOR UPDATE` (tuần tự hoá với handler đóng hội thoại và các tin cùng lúc của
 *    cặp, nên đếm rate limit chính xác) → không có → `NOT_FOUND` → người ngoài cặp → `NOT_PARTICIPANT` (trước mọi
 *    kiểm tra trạng thái) → đã đóng / qua `closesAt` → `CONVERSATION_CLOSED` → đã gửi ≥ `MESSAGE_RATE_LIMIT_PER_MINUTE`
 *    tin trong 60 giây → `RATE_LIMITED` → sàng lọc nội dung → lưu tin + event (`MessageSent`, `MessageFlagged`).
 * 4. Tin bị gắn cờ lừa đảo (BE-S6-03) → thêm tin hệ thống `FRAUD_WARNING` chỉ người nhận thấy (`visibleTo`), cùng `tx`.
 *
 * Idempotency key phía client (BE-S6-02, `clientMessageId` sai dạng → `INVALID_ID` trước khi chạm DB): sau khi khoá
 * hội thoại và kiểm tra người gửi thuộc cặp, tra tin cũ theo (người gửi, key) → có → trả lại tin đó (`replayed`, không
 * kiểm tra trạng thái/rate limit, không tạo tin, không event); key đã dùng ở hội thoại khác → `CLIENT_MESSAGE_ID_CONFLICT`.
 * Unique (`sender_id`, `client_message_id`) ở DB làm chốt chặn cuối.
 * Không log nội dung tin (PII).
 */
export class SendMessage {
  private readonly screener: MessageScreener;

  constructor(private readonly deps: SendMessageDeps) {
    this.screener = deps.screener ?? PASS_THROUGH_SCREENER;
  }

  async execute(cmd: SendMessageCommand): Promise<Result<SentMessageView, SendMessageError>> {
    const body = parseMessageBody(cmd.body);
    if (body.isErr()) return err(body.error);
    const conversationId = parseId<'Conversation'>(cmd.conversationId);
    if (conversationId.isErr()) return err(conversationId.error);
    const senderId = cmd.senderId.toLowerCase();
    let clientMessageId: ClientMessageId | null = null;
    if (cmd.clientMessageId !== undefined) {
      const parsed = parseClientMessageId(cmd.clientMessageId);
      if (parsed.isErr()) return err(parsed.error);
      clientMessageId = parsed.value;
    }

    return this.deps.uow.run(async (tx): Promise<Result<SentMessageView, SendMessageError>> => {
      const now = this.deps.clock.now();
      const conversation = await this.deps.conversations.findByIdForUpdate(tx, conversationId.value);
      if (!conversation) return fail('NOT_FOUND');
      if (clientMessageId !== null && conversation.isParticipant(senderId)) {
        const previous = await this.deps.messages.findByClientMessageId(tx, { senderId, clientMessageId });
        if (previous) {
          if (previous.conversationId !== conversation.id) return fail('CLIENT_MESSAGE_ID_CONFLICT');
          return ok(toSentView(previous, senderId, true));
        }
      }
      const allowed = conversation.ensureCanSend(senderId, now);
      if (allowed.isErr()) return err(allowed.error);

      const sentInWindow = await this.deps.messages.countSentSince(tx, {
        conversationId: conversation.id,
        senderId,
        since: messageRateWindowStart(now),
      });
      const withinLimit = checkMessageRateLimit(sentInWindow);
      if (withinLimit.isErr()) return err(withinLimit.error);

      const sent = Message.send(
        conversation,
        {
          id: newId<'Message'>(),
          senderId,
          body: body.value,
          screening: this.screener(body.value),
          clientMessageId,
        },
        now,
      );
      if (sent.isErr()) return err(sent.error);
      const message = sent.value;
      const state = message.toState();
      await this.deps.messages.save(tx, message);
      const warnings: SentSystemMessageView[] = [];
      if (state.flagged) {
        for (const recipientId of conversation.recipientsOf(senderId)) {
          const warning = { id: newId<'Message'>(), code: 'FRAUD_WARNING', visibleTo: recipientId } as const;
          const system = Message.system(conversation, warning, now);
          const s = system.toState();
          warnings.push({
            messageId: s.id,
            conversationId: s.conversationId,
            systemCode: warning.code,
            body: s.body,
            visibleTo: s.visibleTo,
            sentAt: s.sentAt,
          });
          await this.deps.messages.save(tx, system);
        }
      }
      return ok({ ...toSentView(state, senderId, false), systemMessages: warnings });
    });
  }
}

/** Tin người dùng (`TEXT`) của `senderId` → view trả cho người gửi. */
function toSentView(state: MessageState, senderId: string, replayed: boolean): SentMessageView {
  return {
    messageId: state.id,
    conversationId: state.conversationId,
    senderId,
    kind: 'TEXT',
    body: state.body,
    maskedBody: state.maskedBody,
    flagged: state.flagged,
    clientMessageId: state.clientMessageId,
    sentAt: state.sentAt,
    replayed,
    systemMessages: [],
  };
}
