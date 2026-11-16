import { sql } from 'drizzle-orm';
import {
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
