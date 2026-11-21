import { timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { check, index, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { matching } from './schema-base.js';

/**
 * Độc quyền 1-1 (ARCHITECTURE mục 5, A10): mỗi người dùng tối đa một dòng (`user_id` PK) = đang ở trong một match mở.
 * Tạo match = insert 2 dòng trong cùng `tx` (trùng PK → `USER_BUSY`); đóng match = xoá các dòng theo `match_id`.
 * Repository/migration: BE-S5-02. `CandidateFinder` (BE-S5-03) dùng bảng này để loại người đang bận.
 */
export const activeSlots = matching.table(
  'active_slots',
  {
    userId: uuid('user_id').primaryKey(),
    matchId: uuid('match_id').notNull(),
    claimedAt: timestamptz('claimed_at').notNull(),
  },
  (t) => [index('active_slots_match_id_idx').on(t.matchId)],
);

/** Thời gian nghỉ sau khi dừng tìm hiểu (`COOLDOWN_DAYS`): người dùng đang cooldown khi `now < until`. */
export const cooldowns = matching.table('cooldowns', {
  userId: uuid('user_id').primaryKey(),
  until: timestamptz('until').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
});

/**
 * Lịch sử cặp đã được đề xuất (đã từ chối / hết hạn / đóng) để không đề xuất lại. Cặp lưu chuẩn hoá
 * `user_low < user_high` (so sánh uuid) → mỗi cặp một dòng.
 */
export const pairHistory = matching.table(
  'pair_history',
  {
    userLow: uuid('user_low').notNull(),
    userHigh: uuid('user_high').notNull(),
    lastOutcome: text('last_outcome').notNull(),
    lastMatchId: uuid('last_match_id').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'pair_history_pk', columns: [t.userLow, t.userHigh] }),
    check('pair_history_order_ck', sql`${t.userLow} < ${t.userHigh}`),
    index('pair_history_user_high_idx').on(t.userHigh),
  ],
);
