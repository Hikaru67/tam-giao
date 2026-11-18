import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Schema hạ tầng dùng chung (outbox, chống xử lý trùng). Mỗi module nghiệp vụ có schema riêng (AGENTS.md mục 4). */
export const platform = pgSchema('platform');

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Domain event chờ phát. Ghi cùng transaction với dữ liệu nghiệp vụ (AGENTS.md A6). */
export const outbox = platform.table(
  'outbox',
  {
    /** = `DomainEvent.eventId`. */
    id: uuid('id').primaryKey(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    publishedAt: timestamptz('published_at'),
  },
  (t) => [
    // Relay chỉ quét event chưa phát → partial index nhỏ.
    index('outbox_unpublished_idx')
      .on(t.createdAt)
      .where(sql`${t.publishedAt} is null`),
    // Hai transaction cùng ghi một version của aggregate → một bên lỗi (chặn ghi đè đồng thời).
    uniqueIndex('outbox_aggregate_version_uq').on(t.aggregateType, t.aggregateId, t.aggregateVersion),
  ],
);

/** Consumer đã xử lý event nào — để handler idempotent (AGENTS.md A9). */
export const processedEvents = platform.table(
  'processed_events',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: timestamptz('processed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumer, t.eventId] })],
);

/**
 * Upload qua presigned URL (BE-S2-07): ghi lại ai được cấp key nào, để module nghiệp vụ xác nhận quyền sở hữu
 * (`UploadRegistry.verifyOwned`) trước khi gắn key vào hồ sơ. `PENDING` = đã cấp URL; `CONFIRMED` = object đã có
 * trên storage, đúng loại/kích thước, và đã được một module nhận.
 */
export const uploads = platform.table(
  'uploads',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    key: text('key').notNull().unique('uploads_key_uq'),
    bucket: text('bucket').notNull(),
    purpose: text('purpose').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: text('status').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    /** Hạn của URL PUT; sau mốc này không tải lên được nữa. */
    expiresAt: timestamptz('expires_at').notNull(),
    confirmedAt: timestamptz('confirmed_at'),
  },
  (t) => [
    check('uploads_bucket_ck', sql`${t.bucket} in ('publicProfile', 'privateKyc')`),
    check(
      'uploads_purpose_ck',
      sql`${t.purpose} in ('profile_photo', 'kyc_doc', 'kyc_selfie', 'report_evidence')`,
    ),
    check('uploads_status_ck', sql`${t.status} in ('PENDING', 'CONFIRMED')`),
    check('uploads_size_ck', sql`${t.sizeBytes} > 0`),
    index('uploads_owner_id_idx').on(t.ownerId),
  ],
);
