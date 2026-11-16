import { bytea, timestamptz } from '@tamgiao/db';
import { bigserial, index, integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';

/** Schema Postgres của module identity (AGENTS.md mục 4). */
export const identity = pgSchema('identity');

export const users = identity.table('users', {
  id: uuid('id').primaryKey(),
  /** SĐT E.164, mã hoá qua `Encryptor` (context `identity.users.phone:<id>`). */
  phoneEnc: bytea('phone_enc').notNull(),
  /** Blind index của SĐT — unique: một SĐT chỉ có một tài khoản (A10). */
  phoneBidx: text('phone_bidx').notNull().unique('users_phone_bidx_uq'),
  version: integer('version').notNull(),
  createdAt: timestamptz('created_at').notNull(),
});

/** Mỗi SĐT (theo blind index) chỉ có một challenge: yêu cầu OTP mới ghi đè cái cũ. */
export const otpChallenges = identity.table('otp_challenges', {
  phoneBidx: text('phone_bidx').primaryKey(),
  id: uuid('id').notNull(),
  codeHash: text('code_hash').notNull(),
  createdAt: timestamptz('created_at').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  failedAttempts: integer('failed_attempts').notNull(),
  consumedAt: timestamptz('consumed_at'),
});

/** Lượt đã tính của rate limiter (cửa sổ trượt). `key` là khoá đã băm, không chứa PII thô. */
export const rateLimitHits = identity.table(
  'rate_limit_hits',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    key: text('key').notNull(),
    hitAt: timestamptz('hit_at').notNull(),
  },
  (t) => [index('rate_limit_hits_key_hit_at_idx').on(t.key, t.hitAt)],
);
