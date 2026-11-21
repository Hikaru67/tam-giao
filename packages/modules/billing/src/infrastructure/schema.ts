import { timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

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

/** Tên constraint — repository map vi phạm unique (23505) sang kết quả nghiệp vụ (BE-S4-03). */
export const PAYMENT_ORDER_ID_UNIQUE = 'payments_order_id_uq';
export const PAYMENT_GATEWAY_TXN_UNIQUE = 'payments_gateway_txn_id_uq';
export const PAYMENT_IDEMPOTENCY_UNIQUE = 'payments_user_id_idempotency_key_uq';
export const PAYMENT_ACTIVE_PER_USER_UNIQUE = 'payments_active_per_user_uq';

/**
 * Khoản thanh toán xác thực (BE-S4-03). Luật "mỗi người dùng tối đa 1 khoản `PENDING | SUCCEEDED`" được DB bảo đảm
 * bằng partial unique index `payments_active_per_user_uq` (A10). `gateway_txn_id` unique — khoá idempotency webhook.
 * `checkout_url`/`qr_data` lưu phiên thanh toán của cổng để trả lại khi client gọi lại (idempotent).
 */
export const payments = billing.table(
  'payments',
  {
    id: uuid('id').primaryKey(),
    orderId: text('order_id').notNull(),
    userId: uuid('user_id').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    status: text('status').notNull(),
    gatewayTxnId: text('gateway_txn_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    failureReason: text('failure_reason'),
    checkoutUrl: text('checkout_url'),
    qrData: text('qr_data'),
    createdAt: timestamptz('created_at').notNull(),
    succeededAt: timestamptz('succeeded_at'),
    failedAt: timestamptz('failed_at'),
    refundRequestedAt: timestamptz('refund_requested_at'),
    refundedAt: timestamptz('refunded_at'),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    unique(PAYMENT_ORDER_ID_UNIQUE).on(t.orderId),
    unique(PAYMENT_GATEWAY_TXN_UNIQUE).on(t.gatewayTxnId),
    unique(PAYMENT_IDEMPOTENCY_UNIQUE).on(t.userId, t.idempotencyKey),
    uniqueIndex(PAYMENT_ACTIVE_PER_USER_UNIQUE)
      .on(t.userId)
      .where(sql`${t.status} in ('PENDING', 'SUCCEEDED')`),
    check(
      'payments_status_ck',
      sql`${t.status} in ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUND_PENDING', 'REFUNDED')`,
    ),
    check('payments_amount_ck', sql`${t.amount} > 0`),
    check(
      'payments_gateway_txn_ck',
      sql`(${t.status} in ('PENDING', 'FAILED')) = (${t.gatewayTxnId} is null)`,
    ),
    index('payments_user_id_created_at_idx').on(t.userId, t.createdAt),
  ],
);

/**
 * Sổ cái (BE-S4-03) — **chỉ ghi thêm**: trigger chặn UPDATE/DELETE (viết tay trong migration, giống
 * `identity.audit_logs`). Mỗi khoản thanh toán chỉ một `CHARGE`/`REFUND`, mỗi voucher chỉ một bút toán mỗi loại
 * (partial unique index) — chặn ghi trùng ở tầng DB kể cả khi webhook lặp lại.
 */
export const ledgerEntries = billing.table(
  'ledger_entries',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    userId: uuid('user_id').notNull(),
    paymentId: uuid('payment_id').references(() => payments.id),
    voucherId: uuid('voucher_id').references((): AnyPgColumn => vouchers.id),
    occurredAt: timestamptz('occurred_at').notNull(),
  },
  (t) => [
    check(
      'ledger_entries_type_ck',
      sql`${t.type} in ('CHARGE', 'REFUND', 'VOUCHER_ISSUE', 'VOUCHER_REDEEM', 'VOUCHER_VOID')`,
    ),
    check('ledger_entries_amount_ck', sql`${t.amount} > 0`),
    check(
      'ledger_entries_reference_ck',
      sql`(${t.type} in ('CHARGE', 'REFUND') and ${t.paymentId} is not null) or (${t.type} not in ('CHARGE', 'REFUND') and ${t.voucherId} is not null)`,
    ),
    uniqueIndex('ledger_entries_payment_type_uq')
      .on(t.paymentId, t.type)
      .where(sql`${t.type} in ('CHARGE', 'REFUND')`),
    uniqueIndex('ledger_entries_voucher_type_uq')
      .on(t.voucherId, t.type)
      .where(sql`${t.voucherId} is not null`),
    index('ledger_entries_user_id_idx').on(t.userId, t.occurredAt),
    index('ledger_entries_occurred_at_idx').on(t.occurredAt),
  ],
);

/**
 * Voucher hẹn hò (BE-S4-03): một khoản thanh toán sinh tối đa một voucher (`payment_id` unique). `expires_at` NULL tới
 * khi hồ sơ được duyệt; `partner_id` NULL khi chưa gắn quán.
 */
export const vouchers = billing.table(
  'vouchers',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    value: bigint('value', { mode: 'bigint' }).notNull(),
    status: text('status').notNull(),
    partnerId: uuid('partner_id').references(() => partners.id),
    expiresAt: timestamptz('expires_at'),
    issuedAt: timestamptz('issued_at').notNull(),
    activatedAt: timestamptz('activated_at'),
    redeemedAt: timestamptz('redeemed_at'),
    redeemedByPartnerId: uuid('redeemed_by_partner_id').references(() => partners.id),
    voidedAt: timestamptz('voided_at'),
    voidReason: text('void_reason'),
    expiredAt: timestamptz('expired_at'),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    unique('vouchers_payment_id_uq').on(t.paymentId),
    check('vouchers_status_ck', sql`${t.status} in ('RESERVED', 'ACTIVE', 'REDEEMED', 'VOID', 'EXPIRED')`),
    check('vouchers_value_ck', sql`${t.value} > 0`),
    index('vouchers_user_id_idx').on(t.userId, t.issuedAt),
    index('vouchers_status_expires_at_idx').on(t.status, t.expiresAt),
  ],
);

/** Tên constraint unique theo ngày — `insertIfAbsent` dùng `ON CONFLICT` trên cột này (BE-S4-07). */
export const RECONCILIATION_REPORT_DATE_UNIQUE = 'reconciliation_reports_report_date_uq';

/**
 * Báo cáo đối soát ledger hằng ngày (BE-S4-07). Mỗi ngày (giờ VN) tối đa một báo cáo (`report_date` unique → job chạy
 * lại cùng ngày không ghi thêm). Ghi cả khi khớp để có lịch sử. Các tổng là snapshot tích luỹ tại `run_at` (as-of),
 * tiền `bigint` (A8). `mismatches` là mảng `{check, ledger, state, difference}` (số dạng chuỗi); rỗng ⇔ `MATCHED`.
 */
export const reconciliationReports = billing.table(
  'reconciliation_reports',
  {
    id: uuid('id').primaryKey(),
    reportDate: date('report_date', { mode: 'string' }).notNull(),
    runAt: timestamptz('run_at').notNull(),
    status: text('status').notNull(),
    ledgerChargeTotal: bigint('ledger_charge_total', { mode: 'bigint' }).notNull(),
    ledgerRefundTotal: bigint('ledger_refund_total', { mode: 'bigint' }).notNull(),
    heldPaymentTotal: bigint('held_payment_total', { mode: 'bigint' }).notNull(),
    heldPaymentCount: integer('held_payment_count').notNull(),
    voucherIssueEntries: integer('voucher_issue_entries').notNull(),
    voucherRedeemEntries: integer('voucher_redeem_entries').notNull(),
    voucherVoidEntries: integer('voucher_void_entries').notNull(),
    vouchersReserved: integer('vouchers_reserved').notNull(),
    vouchersActive: integer('vouchers_active').notNull(),
    vouchersRedeemed: integer('vouchers_redeemed').notNull(),
    vouchersVoid: integer('vouchers_void').notNull(),
    vouchersExpired: integer('vouchers_expired').notNull(),
    mismatches: jsonb('mismatches').notNull(),
  },
  (t) => [
    unique(RECONCILIATION_REPORT_DATE_UNIQUE).on(t.reportDate),
    check('reconciliation_reports_status_ck', sql`${t.status} in ('MATCHED', 'MISMATCH')`),
    check(
      'reconciliation_reports_mismatches_ck',
      sql`case when jsonb_typeof(${t.mismatches}) = 'array' then (${t.status} = 'MATCHED') = (jsonb_array_length(${t.mismatches}) = 0) else false end`,
    ),
    index('reconciliation_reports_run_at_idx').on(t.runAt, t.id),
    index('reconciliation_reports_status_run_at_idx').on(t.status, t.runAt, t.id),
  ],
);
