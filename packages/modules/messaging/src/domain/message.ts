import { AggregateRoot, err, ok, type Id, type Result } from '@tamgiao/kernel';
import type {
  Conversation,
  ConversationId,
  ConversationSendError,
  ConversationUserId,
} from './conversation.js';
import type { MessageBody, MessageScreening } from './message-policy.js';
import { MESSAGE_FLAGGED, MESSAGE_SENT } from './messaging-events.js';

export type MessageId = Id<'Message'>;

/** `IMAGE` khai báo sẵn cho hợp đồng/DB; gửi ảnh cần mục đích upload riêng (chưa làm ở BE-S6-01). */
export const MESSAGE_KINDS = ['TEXT', 'IMAGE', 'SYSTEM'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const SYSTEM_MESSAGE_CODES = ['CONVERSATION_OPENED', 'CONVERSATION_CLOSED'] as const;
export type SystemMessageCode = (typeof SYSTEM_MESSAGE_CODES)[number];

/** Câu hiển thị mặc định của tin hệ thống (FE có thể tự dịch theo `systemCode`). */
export const SYSTEM_MESSAGE_TEXT: Readonly<Record<SystemMessageCode, string>> = {
  CONVERSATION_OPENED:
    'Hai bạn đã đồng ý kết nối. Cuộc trò chuyện mở trong giai đoạn tìm hiểu — hãy tôn trọng và không chia sẻ thông tin tài chính.',
  CONVERSATION_CLOSED: 'Cuộc trò chuyện đã đóng.',
};

export interface MessageState {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  /** Người gửi; `null` với tin hệ thống. */
  readonly senderId: ConversationUserId | null;
  readonly kind: MessageKind;
  /** Chỉ tin `SYSTEM` có mã. */
  readonly systemCode: SystemMessageCode | null;
  /** Nội dung gốc (PII — không log, không đưa vào event). */
  readonly body: string;
  /** Nội dung hiển thị cho người nhận khi có phần bị che (BE-S6-03); `null` = hiển thị nguyên `body`. */
  readonly maskedBody: string | null;
  /** Bộ lọc lừa đảo gắn cờ (BE-S6-03). */
  readonly flagged: boolean;
  /** Mã luật khiến tin bị gắn cờ (rỗng khi không gắn cờ). */
  readonly flagReasons: readonly string[];
  readonly sentAt: Date;
  readonly version: number;
}

type MutableState = Omit<MessageState, 'version'>;

/**
 * Aggregate `Message` — một tin trong hội thoại. Tạo một lần, không sửa ở BE-S6-01.
 *
 * - `Message.send(conversation, …)`: tin người dùng (`TEXT`). Kiểm tra `conversation.ensureCanSend` (người gửi thuộc
 *   cặp, hội thoại còn mở và chưa qua `closesAt`) — không thể tạo tin bỏ qua luật này. Kết quả sàng lọc (`screening`)
 *   quyết định `maskedBody`/`flagged`. Event: `MessageSent`; thêm `MessageFlagged` khi bị gắn cờ.
 * - `Message.system(conversation, code, …)`: tin hệ thống (mở/đóng hội thoại), gửi cho cả hai, event `MessageSent`.
 */
export class Message extends AggregateRoot<MessageId> {
  protected readonly aggregateType = 'Message';

  private constructor(
    private readonly state: MutableState,
    version: number,
  ) {
    super(state.id, version);
  }

  static send(
    conversation: Conversation,
    input: {
      readonly id: MessageId;
      readonly senderId: ConversationUserId;
      readonly body: MessageBody;
      readonly screening: MessageScreening;
    },
    now: Date,
  ): Result<Message, ConversationSendError> {
    const allowed = conversation.ensureCanSend(input.senderId, now);
    if (allowed.isErr()) return err(allowed.error);
    const { screening } = input;
    if (screening.flagged && screening.reasons.length === 0) {
      throw new Error('MessageScreening: tin bị gắn cờ phải có ít nhất một mã luật');
    }
    const senderId = input.senderId.toLowerCase();
    const message = new Message(
      {
        id: input.id,
        conversationId: conversation.id,
        senderId,
        kind: 'TEXT',
        systemCode: null,
        body: input.body,
        maskedBody: screening.maskedBody,
        flagged: screening.flagged,
        flagReasons: screening.flagged ? [...screening.reasons] : [],
        sentAt: new Date(now.getTime()),
      },
      0,
    );
    message.recordSent(conversation.recipientsOf(senderId), now);
    if (screening.flagged) {
      message.record(
        MESSAGE_FLAGGED,
        {
          messageId: message.id,
          conversationId: conversation.id,
          senderId,
          reasons: [...message.state.flagReasons],
        },
        now,
      );
    }
    return ok(message);
  }

  static system(
    conversation: Conversation,
    input: { readonly id: MessageId; readonly code: SystemMessageCode },
    now: Date,
  ): Message {
    const message = new Message(
      {
        id: input.id,
        conversationId: conversation.id,
        senderId: null,
        kind: 'SYSTEM',
        systemCode: input.code,
        body: SYSTEM_MESSAGE_TEXT[input.code],
        maskedBody: null,
        flagged: false,
        flagReasons: [],
        sentAt: new Date(now.getTime()),
      },
      0,
    );
    message.recordSent(conversation.recipientsOf(null), now);
    return message;
  }

  static restore(state: MessageState): Message {
    const { version, ...rest } = state;
    return new Message(rest, version);
  }

  /** Nội dung người nhận thấy: bản đã che nếu có, ngược lại nội dung gốc. */
  get displayBody(): string {
    return this.state.maskedBody ?? this.state.body;
  }

  toState(): MessageState {
    return { ...this.state, flagReasons: [...this.state.flagReasons], version: this.version };
  }

  private recordSent(recipientIds: readonly ConversationUserId[], now: Date): void {
    this.record(
      MESSAGE_SENT,
      {
        messageId: this.id,
        conversationId: this.state.conversationId,
        senderId: this.state.senderId,
        recipientIds: [...recipientIds],
        kind: this.state.kind,
        systemCode: this.state.systemCode,
        flagged: this.state.flagged,
        sentAt: this.state.sentAt.toISOString(),
      },
      now,
    );
  }
}
