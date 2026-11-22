import { ACCOUNT_DELETION_REQUESTED } from '@tamgiao/contracts';
import { asDbTx, type EventBus } from '@tamgiao/db';
import type { DomainEvent, Tx } from '@tamgiao/kernel';
import type { PersonalDataSection, PersonalDataSource } from '@tamgiao/module-identity/facade';
import { and, asc, eq, or } from 'drizzle-orm';
import { conversationReads, conversations, messages } from './schema.js';

/**
 * Quyền dữ liệu cá nhân của module messaging (BE-S7-06): consumer khi người dùng xoá tài khoản + nguồn dữ liệu cho file
 * xuất. Thao tác dữ liệu thuần trên bảng của chính module.
 */

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const MESSAGING_ERASE_ON_ACCOUNT_DELETION_CONSUMER = 'messaging.erase-on-account-deletion';

/** Nội dung thay cho tin của người đã xoá tài khoản (rỗng — app hiển thị "Tin nhắn đã bị xoá"). */
export const ERASED_MESSAGE_BODY = '';

function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

/**
 * `AccountDeletionRequested` → xoá nội dung mọi tin người này đã gửi (`body` = rỗng, `masked_body` + `client_message_id`
 * = NULL; giữ dòng tin, cờ + mã luật gắn cờ để lịch sử hội thoại/kiểm duyệt của người kia không vỡ) và con trỏ đã đọc
 * của người này. Hội thoại do matching đóng (`MatchLocked`). Tin người kia gửi là dữ liệu của người kia — giữ nguyên.
 * Idempotent (A9): ghi lại giá trị rỗng/NULL không đổi kết quả.
 */
export function registerMessagingAccountDeletionConsumer(bus: EventBus): void {
  bus.on(ACCOUNT_DELETION_REQUESTED, MESSAGING_ERASE_ON_ACCOUNT_DELETION_CONSUMER, async (event, tx) => {
    const userId = userIdOf(event);
    const db = asDbTx(tx);
    await db
      .update(messages)
      .set({ body: ERASED_MESSAGE_BODY, maskedBody: null, clientMessageId: null })
      .where(eq(messages.senderId, userId));
    await db.delete(conversationReads).where(eq(conversationReads.userId, userId));
  });
}

/**
 * Mục `messaging` của file xuất: các hội thoại của người này (id, thời gian) và **chỉ tin chính người này gửi** (nội dung
 * gốc). Tin của người kia là dữ liệu của người kia nên không xuất.
 */
export function createMessagingPersonalDataSource(): PersonalDataSource {
  return {
    section: 'messaging',
    async collect(tx: Tx, userId: string): Promise<PersonalDataSection> {
      const db = asDbTx(tx);
      const convs = await db
        .select()
        .from(conversations)
        .where(or(eq(conversations.userA, userId), eq(conversations.userB, userId)))
        .orderBy(asc(conversations.openedAt));
      const sent = await db
        .select()
        .from(messages)
        .where(and(eq(messages.senderId, userId), eq(messages.kind, 'TEXT')))
        .orderBy(asc(messages.id));
      return {
        data: {
          conversations: convs.map((c) => ({
            conversationId: c.id,
            status: c.status,
            openedAt: c.openedAt.toISOString(),
            closedAt: c.closedAt?.toISOString() ?? null,
          })),
          sentMessages: sent.map((m) => ({
            conversationId: m.conversationId,
            sentAt: m.sentAt.toISOString(),
            body: m.body,
          })),
        },
        files: [],
      };
    },
  };
}
