import { timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** Schema Postgres của module messaging (AGENTS.md mục 4). drizzle-kit đọc file này. */
export const messaging = pgSchema('messaging');

/**
 * Aggregate `Conversation` (BE-S6-01). `match_id` UNIQUE: mỗi match tối đa một hội thoại — chốt chặn ở DB cho handler
 * `MatchStartedDating` chạy trùng/đồng thời (A10). Hai người lưu `user_a`/`user_b` như `matching.matches`.
 */
export const conversations = messaging.table(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    matchId: uuid('match_id').notNull(),
    userA: uuid('user_a').notNull(),
    userB: uuid('user_b').notNull(),
    status: text('status').notNull(),
    openedAt: timestamptz('opened_at').notNull(),
    closesAt: timestamptz('closes_at').notNull(),
    closedAt: timestamptz('closed_at'),
    closeReason: text('close_reason'),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    unique('conversations_match_id_uq').on(t.matchId),
    check('conversations_distinct_users_ck', sql`${t.userA} <> ${t.userB}`),
    check('conversations_status_ck', sql`${t.status} in ('OPEN', 'CLOSED')`),
    check('conversations_close_reason_ck', sql`${t.closeReason} in ('MATCH_CLOSED', 'MATCH_LOCKED')`),
    check(
      'conversations_closed_state_ck',
      sql`(${t.status} = 'CLOSED') = (${t.closedAt} is not null and ${t.closeReason} is not null)`,
    ),
    check('conversations_period_ck', sql`${t.closesAt} >= ${t.openedAt}`),
    check('conversations_version_ck', sql`${t.version} >= 1`),
    index('conversations_user_a_idx').on(t.userA),
    index('conversations_user_b_idx').on(t.userB),
  ],
);

/**
 * Tin nhắn (BE-S6-01). `body` là nội dung gốc — PII: không log, không đưa vào event/audit. `masked_body` = bản hiển
 * thị khi bị che liên hệ (BE-S6-03), `flagged` + `flag_reasons` (mã luật) từ bộ lọc lừa đảo. Tin hệ thống: không có
 * người gửi, có `system_code`. Index (`conversation_id`, `id`) cho phân trang theo thời gian (id UUID v7);
 * (`conversation_id`, `sender_id`, `sent_at`) cho đếm rate limit. `client_message_id` = idempotency key phía client
 * (BE-S6-02): unique (`sender_id`, `client_message_id`) — gửi lại cùng key không tạo tin trùng (NULL không đụng nhau).
 */
export const messages = messaging.table(
  'messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    senderId: uuid('sender_id'),
    kind: text('kind').notNull(),
    systemCode: text('system_code'),
    body: text('body').notNull(),
    maskedBody: text('masked_body'),
    flagged: boolean('flagged').notNull().default(false),
    flagReasons: text('flag_reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    clientMessageId: uuid('client_message_id'),
    sentAt: timestamptz('sent_at').notNull(),
    /** BE-S6-03: tin hệ thống chỉ một participant thấy (cảnh báo lừa đảo cho người nhận); null = cả hai. */
    visibleTo: uuid('visible_to'),
  },
  (t) => [
    unique('messages_sender_client_message_id_uq').on(t.senderId, t.clientMessageId),
    check('messages_kind_ck', sql`${t.kind} in ('TEXT', 'IMAGE', 'SYSTEM')`),
    check(
      'messages_system_code_ck',
      sql`${t.systemCode} in ('CONVERSATION_OPENED', 'CONVERSATION_CLOSED', 'FRAUD_WARNING')`,
    ),
    check('messages_visible_to_ck', sql`${t.visibleTo} is null or ${t.kind} = 'SYSTEM'`),
    check(
      'messages_system_shape_ck',
      sql`(${t.kind} = 'SYSTEM') = (${t.senderId} is null) and (${t.kind} = 'SYSTEM') = (${t.systemCode} is not null)`,
    ),
    check('messages_flag_reasons_ck', sql`${t.flagged} = (cardinality(${t.flagReasons}) > 0)`),
    index('messages_conversation_id_idx').on(t.conversationId, t.id),
    index('messages_rate_limit_idx').on(t.conversationId, t.senderId, t.sentAt),
  ],
);

/**
 * Con trỏ đã đọc theo participant (BE-S6-04): mỗi (hội thoại, người dùng) một dòng, `last_read_message_id` = tin mới nhất
 * đã đọc (mọi tin id ≤ con trỏ coi là đã đọc — id UUID v7 tăng theo thời gian). Chỉ tiến: UPSERT có điều kiện
 * `last_read_message_id < excluded.last_read_message_id`. `user_id` tham chiếu tài khoản module identity — không FK (A3).
 */
export const conversationReads = messaging.table(
  'conversation_reads',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    userId: uuid('user_id').notNull(),
    lastReadMessageId: uuid('last_read_message_id')
      .notNull()
      .references(() => messages.id),
    readAt: timestamptz('read_at').notNull(),
  },
  (t) => [primaryKey({ name: 'conversation_reads_pk', columns: [t.conversationId, t.userId] })],
);
