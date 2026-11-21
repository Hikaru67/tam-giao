import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, eq, sql } from 'drizzle-orm';
import type {
  ConversationReadRepository,
  ConversationReadState,
} from '../application/ports/conversation-read-repository.js';
import type { ConversationId, ConversationUserId } from '../domain/conversation.js';
import type { MessageId } from '../domain/message.js';
import { conversationReads } from './schema.js';

type ReadRow = typeof conversationReads.$inferSelect;

const toState = (r: ReadRow): ConversationReadState => ({
  conversationId: r.conversationId as ConversationId,
  userId: r.userId,
  lastReadMessageId: r.lastReadMessageId as MessageId,
  readAt: r.readAt,
});

/**
 * Hiện thực `ConversationReadRepository` trên `messaging.conversation_reads`, trong `tx` của caller. Con trỏ chỉ tiến nhờ
 * UPSERT có điều kiện `WHERE last_read_message_id < excluded.last_read_message_id` — hai thiết bị gửi đồng thời vẫn giữ
 * con trỏ lớn nhất (khoá dòng của `ON CONFLICT` tuần tự hoá hai câu lệnh).
 */
export class DrizzleConversationReadRepository implements ConversationReadRepository {
  async advance(
    tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly userId: ConversationUserId;
      readonly messageId: MessageId;
      readonly readAt: Date;
    },
  ): Promise<{ readonly state: ConversationReadState; readonly advanced: boolean }> {
    const userId = input.userId.toLowerCase();
    const [written] = await asDbTx(tx)
      .insert(conversationReads)
      .values({
        conversationId: input.conversationId,
        userId,
        lastReadMessageId: input.messageId,
        readAt: input.readAt,
      })
      .onConflictDoUpdate({
        target: [conversationReads.conversationId, conversationReads.userId],
        set: {
          lastReadMessageId: sql`excluded.last_read_message_id`,
          readAt: sql`excluded.read_at`,
        },
        setWhere: sql`${conversationReads.lastReadMessageId} < excluded.last_read_message_id`,
      })
      .returning();
    if (written) return { state: toState(written), advanced: true };
    const current = await this.find(tx, { conversationId: input.conversationId, userId });
    if (!current)
      throw new Error(`messaging.conversation_reads ${input.conversationId}: mất con trỏ sau UPSERT`);
    return { state: current, advanced: false };
  }

  async find(
    tx: Tx,
    input: { readonly conversationId: ConversationId; readonly userId: ConversationUserId },
  ): Promise<ConversationReadState | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(conversationReads)
      .where(
        and(
          eq(conversationReads.conversationId, input.conversationId),
          eq(conversationReads.userId, input.userId.toLowerCase()),
        ),
      );
    return row ? toState(row) : null;
  }
}
