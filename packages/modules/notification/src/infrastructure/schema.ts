import { timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgSchema, text, unique, uuid } from 'drizzle-orm/pg-core';

/** Schema Postgres của module notification (AGENTS.md mục 4). drizzle-kit đọc file này. */
export const notification = pgSchema('notification');

/**
 * Thiết bị nhận push (BE-S7-05). `token` (Expo push token) UNIQUE: một máy chỉ thuộc một người tại một thời điểm — đăng
 * nhập tài khoản khác trên cùng máy chuyển chủ token. Token hỏng (Expo `DeviceNotRegistered`) bị xoá khi gửi.
 * `user_id` không FK sang `identity` (ranh giới module, A3).
 */
export const devices = notification.table(
  'devices',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull(),
  },
  (t) => [
    unique('devices_token_uq').on(t.token),
    check('devices_platform_ck', sql`${t.platform} in ('ios', 'android')`),
    index('devices_user_id_idx').on(t.userId),
  ],
);

/** Cài đặt nhận thông báo theo nhóm (chỉ nhóm tắt được). Không có dòng = bật hết. */
export const preferences = notification.table('preferences', {
  userId: uuid('user_id').primaryKey(),
  matches: boolean('matches').notNull(),
  messages: boolean('messages').notNull(),
  dates: boolean('dates').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
});

/**
 * Mỗi dòng = một thông báo cho một người, sinh từ một event (BE-S7-05). UNIQUE (`event_id`, `user_id`, `kind`): event
 * xử lý lại không sinh thêm thông báo (AC1, A9). `send_after` = lúc được gửi (nhắc trước hạn: tương lai). Vòng đời:
 * `PENDING → SENT | SKIPPED | FAILED`, hoặc `PENDING → CANCELLED` (nhắc nhở không còn ý nghĩa, vd match đã phản hồi).
 * `aggregate_id` = match / hội thoại / lịch hẹn / báo cáo… để huỷ nhắc nhở và tra người báo cáo. `data` chỉ chứa id
 * (deep link), không PII.
 */
export const deliveries = notification.table(
  'deliveries',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    kind: text('kind').notNull(),
    userId: uuid('user_id').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    data: jsonb('data').$type<Record<string, string>>().notNull(),
    status: text('status').notNull(),
    channel: text('channel'),
    skipReason: text('skip_reason'),
    sendAfter: timestamptz('send_after').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    sentAt: timestamptz('sent_at'),
  },
  (t) => [
    unique('deliveries_event_user_kind_uq').on(t.eventId, t.userId, t.kind),
    check('deliveries_status_ck', sql`${t.status} in ('PENDING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED')`),
    check('deliveries_channel_ck', sql`${t.channel} in ('PUSH', 'SMS')`),
    check(
      'deliveries_sent_ck',
      sql`(${t.status} = 'SENT') = (${t.channel} is not null and ${t.sentAt} is not null)`,
    ),
    check(
      'deliveries_skip_reason_ck',
      sql`(${t.status} in ('SKIPPED', 'FAILED')) = (${t.skipReason} is not null)`,
    ),
    index('deliveries_aggregate_kind_idx').on(t.aggregateId, t.kind),
    index('deliveries_user_id_idx').on(t.userId),
  ],
);
