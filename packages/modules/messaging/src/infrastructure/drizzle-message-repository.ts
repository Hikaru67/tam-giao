import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, asc, count, eq, gt, isNull, or, type InferSelectModel } from 'drizzle-orm';
import type { MessageRepository } from '../application/ports/message-repository.js';
import type { ConversationId, ConversationUserId } from '../domain/conversation.js';
import type {
  ClientMessageId,
  Message,
  MessageId,
  MessageKind,
  MessageState,
  SystemMessageCode,
} from '../domain/message.js';
import { messages } from './schema.js';

type MessageRow = InferSelectModel<typeof messages>;

/** Tin đã lưu không đổi sau khi tạo → version = số event lúc tạo (`MessageSent` + `MessageFlagged` nếu gắn cờ). */
const toState = (r: MessageRow): MessageState => ({
  id: r.id as MessageId,
  conversationId: r.conversationId as ConversationId,
  senderId: r.senderId,
  kind: r.kind as MessageKind,
  systemCode: r.systemCode as SystemMessageCode | null,
  body: r.body,
  maskedBody: r.maskedBody,
  flagged: r.flagged,
  flagReasons: [...r.flagReasons],
  visibleTo: r.visibleTo,
  clientMessageId: r.clientMessageId as ClientMessageId | null,
  sentAt: r.sentAt,
  version: r.flagged ? 2 : 1,
});

/**
 * Hiện thực `MessageRepository` trên `messaging.messages` + outbox, trong `tx` của caller. Tin chỉ được tạo (INSERT),
 * BE-S6-01 không sửa tin. Không log nội dung (PII).
 */
export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async save(tx: Tx, message: Message): Promise<void> {
    const events = message.pullEvents();
    if (events.length === 0) return;
    const s = message.toState();
    if (s.version !== events.length) {
      throw new Error(`messaging.messages ${s.id}: tin đã lưu không được sửa`);
    }
    await asDbTx(tx)
      .insert(messages)
      .values({
        id: s.id,
        conversationId: s.conversationId,
        senderId: s.senderId,
        kind: s.kind,
        systemCode: s.systemCode,
        body: s.body,
        maskedBody: s.maskedBody,
        flagged: s.flagged,
        flagReasons: [...s.flagReasons],
        visibleTo: s.visibleTo,
        clientMessageId: s.clientMessageId,
        sentAt: s.sentAt,
      });
    await this.outbox.append(tx, events);
  }

  async countSentSince(
    tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly senderId: ConversationUserId;
      readonly since: Date;
    },
  ): Promise<number> {
    const [row] = await asDbTx(tx)
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, input.conversationId),
          eq(messages.senderId, input.senderId.toLowerCase()),
          gt(messages.sentAt, input.since),
        ),
      );
    return row?.n ?? 0;
  }

  async findByClientMessageId(
    tx: Tx,
    input: { readonly senderId: ConversationUserId; readonly clientMessageId: ClientMessageId },
  ): Promise<MessageState | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.senderId, input.senderId.toLowerCase()),
          eq(messages.clientMessageId, input.clientMessageId),
        ),
      )
      .limit(1);
    return row ? toState(row) : null;
  }

  async listAfter(
    tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly viewerId: ConversationUserId;
      readonly afterId: MessageId | null;
      readonly limit: number;
    },
  ): Promise<readonly MessageState[]> {
    const rows = await asDbTx(tx)
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, input.conversationId),
          or(isNull(messages.visibleTo), eq(messages.visibleTo, input.viewerId.toLowerCase())),
          input.afterId === null ? undefined : gt(messages.id, input.afterId),
        ),
      )
      .orderBy(asc(messages.id))
      .limit(input.limit);
    return rows.map(toState);
  }
}
