import { asDbTx } from '@tamgiao/db';
import { ok, parseId, type Tx, type UnitOfWork } from '@tamgiao/kernel';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type {
  FlaggedMessageCursor,
  FlaggedMessageDetail,
  FlaggedMessagePage,
  FlaggedMessageSummary,
  MessagingFacade,
} from '../application/facade.js';
import { conversations, messages } from './schema.js';

const columns = {
  messageId: messages.id,
  conversationId: messages.conversationId,
  matchId: conversations.matchId,
  senderId: messages.senderId,
  userA: conversations.userA,
  userB: conversations.userB,
  reasons: messages.flagReasons,
  sentAt: messages.sentAt,
  body: messages.body,
  maskedBody: messages.maskedBody,
};

type Row = {
  messageId: string;
  conversationId: string;
  matchId: string;
  senderId: string | null;
  userA: string;
  userB: string;
  reasons: string[];
  sentAt: Date;
  body: string;
  maskedBody: string | null;
};

/** Tin gắn cờ luôn là tin TEXT/IMAGE của một participant (tin hệ thống không qua bộ lọc) — sai là lỗi dữ liệu. */
function toSummary(row: Row): FlaggedMessageSummary {
  if (row.senderId === null)
    throw new Error(`messaging.messages ${row.messageId}: tin gắn cờ thiếu sender_id`);
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    matchId: row.matchId,
    senderId: row.senderId,
    recipientId: row.senderId === row.userA ? row.userB : row.userA,
    reasons: [...row.reasons],
    sentAt: row.sentAt,
  };
}

/** Keyset "mới nhất trước": dòng có (`sent_at`, `id`) nhỏ hơn cursor. */
function beforeCursor(cursor: FlaggedMessageCursor): SQL | undefined {
  return or(
    lt(messages.sentAt, cursor.sentAt),
    and(eq(messages.sentAt, cursor.sentAt), lt(messages.id, cursor.messageId)),
  );
}

/**
 * Hiện thực `MessagingFacade` (BE-S6-06) bằng truy vấn đọc trên `messaging.messages` ⋈ `messaging.conversations`, mỗi
 * lời gọi một transaction ngắn chỉ đọc. Nội dung tin chỉ trả ở `getFlaggedMessage` — không log.
 */
export class DrizzleMessagingFacade implements MessagingFacade {
  constructor(private readonly uow: UnitOfWork) {}

  async listFlaggedMessages(query: {
    readonly cursor: FlaggedMessageCursor | null;
    readonly limit: number;
  }): Promise<FlaggedMessagePage> {
    const rows = await this.read((tx) =>
      asDbTx(tx)
        .select(columns)
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(eq(messages.flagged, true), query.cursor ? beforeCursor(query.cursor) : undefined))
        .orderBy(desc(messages.sentAt), desc(messages.id))
        .limit(query.limit + 1),
    );
    const page = rows.slice(0, query.limit).map(toSummary);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        rows.length > query.limit && last ? { sentAt: last.sentAt, messageId: last.messageId } : null,
    };
  }

  async getFlaggedMessage(messageId: string): Promise<FlaggedMessageDetail | null> {
    const id = parseId(messageId);
    if (id.isErr()) return null;
    const [row] = await this.read((tx) =>
      asDbTx(tx)
        .select(columns)
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(eq(messages.id, id.value), eq(messages.flagged, true))),
    );
    if (!row) return null;
    return { ...toSummary(row), body: row.body, maskedBody: row.maskedBody };
  }

  private async read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const result = await this.uow.run(async (tx) => ok(await fn(tx)));
    if (result.isErr()) throw new Error('unreachable');
    return result.value;
  }
}
