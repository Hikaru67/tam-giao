import { bytea, timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
  /**
   * Thời điểm tài khoản bị xoá theo yêu cầu (BE-S7-06). Khi xoá: `phone_enc` = rỗng, `phone_bidx` = `deleted:<id>` (SĐT
   * đăng ký lại thành tài khoản mới) — trừ tài khoản đang bị khoá vĩnh viễn: giữ `phone_bidx` để vẫn chặn đăng nhập.
   */
  deletedAt: timestamptz('deleted_at'),
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

/**
 * Tài khoản app bị khoá vĩnh viễn (BE-S6-06) — dựng từ event `UserBanned` của safety (A3: không đọc bảng safety).
 * Chỉ id + thời điểm; lý do khoá nằm ở `safety.user_bans`. `VerifyOtp` tra bảng này trước khi mở phiên. Không FK sang
 * `users`: safety không kiểm tra được id tồn tại (A3) — id lạ chỉ là dòng vô hại, không làm consumer lỗi lặp.
 */
export const bannedUsers = identity.table('banned_users', {
  userId: uuid('user_id').primaryKey(),
  bannedAt: timestamptz('banned_at').notNull(),
});

/**
 * Lưu blind index SĐT của tài khoản đã xoá (BE-S7-06) nhằm chống lách lệnh khoá tài khoản.
 * Theo Nghị định 13/2023: xử lý dựa trên lợi ích chính đáng hợp pháp; chỉ lưu HMAC blind index,
 * không giải ngược được, không lưu SĐT rõ hay ciphertext.
 */
export const deletedPhoneIndexes = identity.table(
  'deleted_phone_indexes',
  {
    userId: uuid('user_id').primaryKey(),
    phoneBidx: text('phone_bidx').notNull(),
    deletedAt: timestamptz('deleted_at').notNull(),
  },
  (t) => [index('deleted_phone_indexes_phone_bidx_idx').on(t.phoneBidx)],
);

/** Tài khoản cán bộ quản trị (BE-S2-03). */
export const adminUsers = identity.table(
  'admin_users',
  {
    id: uuid('id').primaryKey(),
    /** Email công vụ đã chuẩn hoá chữ thường — unique. */
    email: text('email').notNull().unique('admin_users_email_uq'),
    /** Chuỗi PHC argon2id. */
    passwordHash: text('password_hash').notNull(),
    /** Secret TOTP, mã hoá qua `Encryptor` (context `identity.admin_users.totp_secret:<id>`). */
    totpSecretEnc: bytea('totp_secret_enc').notNull(),
    role: text('role').notNull(),
    failedLogins: integer('failed_logins').notNull(),
    lockedUntil: timestamptz('locked_until'),
    lastTotpStep: bigint('last_totp_step', { mode: 'number' }),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [check('admin_users_role_ck', sql`${t.role} in ('REVIEWER', 'MATCHMAKER', 'SUPERVISOR', 'ADMIN')`)],
);

/** Phiên đăng nhập admin — chỉ lưu SHA-256 của token. */
export const adminSessions = identity.table(
  'admin_sessions',
  {
    id: uuid('id').primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id),
    tokenHash: text('token_hash').notNull().unique('admin_sessions_token_hash_uq'),
    rememberDevice: boolean('remember_device').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [index('admin_sessions_admin_id_idx').on(t.adminId)],
);

/**
 * Audit log thao tác nhạy cảm (BE-S2-04). **Chỉ ghi thêm**: migration gắn trigger chặn mọi UPDATE/DELETE
 * (kể cả từ role owner mà app đang dùng) và thu hồi UPDATE/DELETE/TRUNCATE khỏi PUBLIC.
 * Không FK tới `admin_users`/`users` vì actor có thể là người dùng app hoặc hệ thống, và bản ghi phải
 * còn nguyên khi tài khoản bị xoá/ẩn danh.
 */
export const auditLogs = identity.table(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    occurredAt: timestamptz('occurred_at').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    ip: text('ip'),
    meta: jsonb('meta').notNull(),
  },
  (t) => [
    check('audit_logs_actor_type_ck', sql`${t.actorType} in ('admin', 'user', 'system')`),
    check(
      'audit_logs_actor_id_ck',
      sql`(${t.actorType} = 'system' and ${t.actorId} is null) or (${t.actorType} <> 'system' and ${t.actorId} is not null)`,
    ),
    index('audit_logs_occurred_at_idx').on(t.occurredAt.desc(), t.id.desc()),
    index('audit_logs_actor_idx').on(t.actorId, t.occurredAt.desc()),
    index('audit_logs_target_idx').on(t.targetType, t.targetId, t.occurredAt.desc()),
  ],
);

/**
 * Yêu cầu xuất dữ liệu cá nhân (BE-S7-06). `payload_enc` = file JSON đã dựng, mã hoá qua `Encryptor` (context
 * `identity.data_exports.payload:<id>`); job định kỳ đặt NULL khi quá `expires_at`. Mỗi người tối đa một yêu cầu
 * `PENDING` (partial unique index — A10).
 */
export const dataExports = identity.table(
  'data_exports',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    status: text('status').notNull(),
    requestedAt: timestamptz('requested_at').notNull(),
    readyAt: timestamptz('ready_at'),
    expiresAt: timestamptz('expires_at'),
    payloadEnc: bytea('payload_enc'),
    version: integer('version').notNull(),
  },
  (t) => [
    check('data_exports_status_ck', sql`${t.status} in ('PENDING', 'READY')`),
    check(
      'data_exports_ready_ck',
      sql`(${t.status} = 'READY') = (${t.readyAt} is not null and ${t.expiresAt} is not null)`,
    ),
    check('data_exports_payload_ck', sql`${t.payloadEnc} is null or ${t.status} = 'READY'`),
    uniqueIndex('data_exports_pending_per_user_uq')
      .on(t.userId)
      .where(sql`${t.status} = 'PENDING'`),
    index('data_exports_user_id_idx').on(t.userId, t.requestedAt),
    index('data_exports_expires_at_idx')
      .on(t.expiresAt)
      .where(sql`${t.payloadEnc} is not null`),
  ],
);

/**
 * Yêu cầu xoá tài khoản (BE-S7-06) — mỗi người một yêu cầu (`user_id` unique, A10). `event_id` = id của
 * `AccountDeletionRequested`: tiến độ từng module = consumer đã ghi `platform.processed_events` cho event này.
 */
export const accountDeletions = identity.table('account_deletions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().unique('account_deletions_user_id_uq'),
  eventId: uuid('event_id').notNull(),
  requestedAt: timestamptz('requested_at').notNull(),
  version: integer('version').notNull(),
});
