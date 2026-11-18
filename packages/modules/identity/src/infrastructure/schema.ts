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

/** Phiên đăng nhập của người dùng app (mỗi thiết bị một phiên). */
export const sessions = identity.table(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceName: text('device_name'),
    createdAt: timestamptz('created_at').notNull(),
    lastUsedAt: timestamptz('last_used_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    revokeReason: text('revoke_reason'),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/** Refresh token của phiên — chỉ lưu SHA-256; giữ cả token đã dùng để phát hiện tái sử dụng. */
export const refreshTokens = identity.table(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique('refresh_tokens_token_hash_uq'),
    createdAt: timestamptz('created_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
  },
  (t) => [index('refresh_tokens_session_id_idx').on(t.sessionId)],
);
