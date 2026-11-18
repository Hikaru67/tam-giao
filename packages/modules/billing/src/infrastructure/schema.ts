import { timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';

/** Schema Postgres của module billing (AGENTS.md mục 4). Bảng được thêm theo task BE-S4-xx. */
export const billing = pgSchema('billing');

/**
 * Quán đối tác an toàn (BE-S4-06). Không xoá quán — chỉ tắt `active` (voucher/lịch hẹn cũ vẫn tham chiếu được).
 */
export const partners = billing.table(
  'partners',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    /** URL https ảnh giới thiệu quán (công khai, không phải dữ liệu cá nhân). */
    photoUrl: text('photo_url'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    active: boolean('active').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    check('partners_name_ck', sql`length(${t.name}) between 1 and 120`),
    check('partners_address_ck', sql`length(${t.address}) between 1 and 300`),
    index('partners_active_name_idx').on(t.active, t.name),
  ],
);

/**
 * Tài khoản nhân viên quán (BE-S4-06): PIN chỉ lưu dạng hash (scrypt + pepper), không bao giờ lưu PIN gốc.
 * `token_version` tăng khi đổi PIN / thiết bị / vô hiệu hoá → token partner cũ bị từ chối.
 */
export const partnerStaff = billing.table(
  'partner_staff',
  {
    id: uuid('id').primaryKey(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id),
    name: text('name').notNull(),
    pinHash: text('pin_hash').notNull(),
    deviceId: text('device_id'),
    active: boolean('active').notNull(),
    failedLogins: integer('failed_logins').notNull(),
    lockedUntil: timestamptz('locked_until'),
    tokenVersion: integer('token_version').notNull(),
    lastLoginAt: timestamptz('last_login_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    check('partner_staff_failed_logins_ck', sql`${t.failedLogins} >= 0`),
    check('partner_staff_token_version_ck', sql`${t.tokenVersion} >= 1`),
    index('partner_staff_partner_id_idx').on(t.partnerId, t.createdAt),
  ],
);
