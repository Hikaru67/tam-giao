import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, count, eq, gt } from 'drizzle-orm';
import type { MessageRepository } from '../application/ports/message-repository.js';
import type { ConversationId, ConversationUserId } from '../domain/conversation.js';
import type { Message } from '../domain/message.js';
import { messages } from './schema.js';

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
}
