import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, eq, or } from 'drizzle-orm';
import type { ConversationRepository } from '../application/ports/conversation-repository.js';
import {
  CONVERSATION_CLOSE_REASONS,
  CONVERSATION_STATUSES,
  Conversation,
  type ConversationCloseReason,
  type ConversationId,
  type ConversationMatchId,
  type ConversationStatus,
  type ConversationUserId,
} from '../domain/conversation.js';
import { conversations } from './schema.js';

type ConversationRow = typeof conversations.$inferSelect;

const isStatus = (v: string): v is ConversationStatus =>
  (CONVERSATION_STATUSES as readonly string[]).includes(v);
const isCloseReason = (v: string): v is ConversationCloseReason =>
  (CONVERSATION_CLOSE_REASONS as readonly string[]).includes(v);

/** Dòng DB → aggregate. Dữ liệu sai dạng là lỗi dữ liệu/lập trình → throw. */
function toConversation(row: ConversationRow): Conversation {
  if (!isStatus(row.status)) throw new Error(`messaging.conversations ${row.id}: status không hợp lệ`);
  const { closeReason } = row;
  if (closeReason !== null && !isCloseReason(closeReason)) {
    throw new Error(`messaging.conversations ${row.id}: close_reason không hợp lệ`);
  }
  return Conversation.restore({
    id: row.id as ConversationId,
    matchId: row.matchId,
    participants: [row.userA, row.userB],
    status: row.status,
    openedAt: row.openedAt,
    closesAt: row.closesAt,
    closedAt: row.closedAt,
    closeReason,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

/**
 * Hiện thực `ConversationRepository` trên `messaging.conversations` + outbox, trong `tx` của caller. Kiểm tra version
 * lạc quan như `DrizzleMatchRepository`: version trước = version − số event chờ; `0` → INSERT, khác → UPDATE có điều
 * kiện version, không khớp → throw.
 */
export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async save(tx: Tx, conversation: Conversation): Promise<void> {
    const events = conversation.pullEvents();
    if (events.length === 0) return;
    const s = conversation.toState();
    const previousVersion = s.version - events.length;
    const db = asDbTx(tx);
    const values = {
      status: s.status,
      closesAt: s.closesAt,
      closedAt: s.closedAt,
      closeReason: s.closeReason,
      updatedAt: s.updatedAt,
      version: s.version,
    };

    if (previousVersion === 0) {
      await db.insert(conversations).values({
        id: s.id,
        matchId: s.matchId,
        userA: s.participants[0],
        userB: s.participants[1],
        openedAt: s.openedAt,
        ...values,
      });
    } else {
      const updated = await db
        .update(conversations)
        .set(values)
        .where(and(eq(conversations.id, s.id), eq(conversations.version, previousVersion)))
        .returning({ id: conversations.id });
      if (updated.length !== 1) {
        throw new Error(`messaging.conversations ${s.id}: xung đột version (mong đợi ${previousVersion})`);
      }
    }
    await this.outbox.append(tx, events);
  }

  async findById(tx: Tx, id: ConversationId): Promise<Conversation | null> {
    const [row] = await asDbTx(tx).select().from(conversations).where(eq(conversations.id, id));
    return row ? toConversation(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: ConversationId): Promise<Conversation | null> {
    const [row] = await asDbTx(tx).select().from(conversations).where(eq(conversations.id, id)).for('update');
    return row ? toConversation(row) : null;
  }

  async findByMatchIdForUpdate(tx: Tx, matchId: ConversationMatchId): Promise<Conversation | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(conversations)
      .where(eq(conversations.matchId, matchId.toLowerCase()))
      .for('update');
    return row ? toConversation(row) : null;
  }

  async listByParticipant(tx: Tx, userId: ConversationUserId): Promise<readonly Conversation[]> {
    const id = userId.toLowerCase();
    const rows = await asDbTx(tx)
      .select()
      .from(conversations)
      .where(or(eq(conversations.userA, id), eq(conversations.userB, id)));
    return rows.map(toConversation);
  }
}
