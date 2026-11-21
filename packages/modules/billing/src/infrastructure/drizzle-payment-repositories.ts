import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import { Money, type Tx } from '@tamgiao/kernel';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { CheckoutSession } from '../application/ports/payment-gateway.js';
import type {
  LedgerRepository,
  StoredPayment,
  VerificationPaymentRepository,
  VoucherRepository,
} from '../application/ports/payment-repositories.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import {
  PAYMENT_STATUSES,
  VerificationPayment,
  type PaymentStatus,
  type VerificationPaymentId,
} from '../domain/verification-payment.js';
import type { Voucher } from '../domain/voucher.js';
import {
  PAYMENT_ACTIVE_PER_USER_UNIQUE,
  PAYMENT_IDEMPOTENCY_UNIQUE,
  ledgerEntries,
  payments,
  vouchers,
} from './schema.js';

type PaymentRow = typeof payments.$inferSelect;

const PG_UNIQUE_VIOLATION = '23505';

/** Tên constraint unique bị vi phạm (lỗi pg nằm trong chuỗi `cause` — Drizzle bọc lỗi driver). */
function uniqueViolationConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === PG_UNIQUE_VIOLATION && typeof e.constraint === 'string') return e.constraint;
    current = e.cause;
  }
  return null;
}

/** Vi phạm unique khi tạo khoản mới mà use case xử lý được (đọc lại để trả kết quả idempotent). */
const INSERT_CONFLICTS = new Set([PAYMENT_ACTIVE_PER_USER_UNIQUE, PAYMENT_IDEMPOTENCY_UNIQUE]);

const isStatus = (v: string): v is PaymentStatus => (PAYMENT_STATUSES as readonly string[]).includes(v);

function toPayment(row: PaymentRow): VerificationPayment {
  if (!isStatus(row.status)) throw new Error(`billing.payments ${row.id}: status trong DB không hợp lệ`);
  return VerificationPayment.restore({
    id: row.id as VerificationPaymentId,
    orderId: row.orderId,
    userId: row.userId,
    amount: Money.ofTrusted(row.amount),
    status: row.status,
    gatewayTxnId: row.gatewayTxnId,
    idempotencyKey: row.idempotencyKey,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    succeededAt: row.succeededAt,
    failedAt: row.failedAt,
    refundRequestedAt: row.refundRequestedAt,
    refundedAt: row.refundedAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

const toCheckout = (row: Pick<PaymentRow, 'checkoutUrl' | 'qrData'>): CheckoutSession | null =>
  row.checkoutUrl !== null && row.qrData !== null
    ? { checkoutUrl: row.checkoutUrl, qrData: row.qrData }
    : null;

const toStored = (row: PaymentRow): StoredPayment => ({ payment: toPayment(row), checkout: toCheckout(row) });

function mutableColumns(payment: VerificationPayment) {
  const s = payment.toState();
  return {
    status: s.status,
    gatewayTxnId: s.gatewayTxnId,
    failureReason: s.failureReason,
    succeededAt: s.succeededAt,
    failedAt: s.failedAt,
    refundRequestedAt: s.refundRequestedAt,
    refundedAt: s.refundedAt,
    updatedAt: s.updatedAt,
    version: s.version,
  };
}

/** Hiện thực `VerificationPaymentRepository` bằng Drizzle + PostgreSQL (`billing.payments`). */
export class DrizzleVerificationPaymentRepository implements VerificationPaymentRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async findByUserAndIdempotencyKey(
    tx: Tx,
    userId: string,
    idempotencyKey: string,
  ): Promise<StoredPayment | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(payments)
      .where(and(eq(payments.userId, userId), eq(payments.idempotencyKey, idempotencyKey)));
    return row ? toStored(row) : null;
  }

  async listByUser(tx: Tx, userId: string): Promise<StoredPayment[]> {
    const rows = await asDbTx(tx)
      .select()
      .from(payments)
      .where(eq(payments.userId, userId))
      .orderBy(desc(payments.createdAt), desc(payments.id));
    return rows.map(toStored);
  }

  async findByOrderIdForUpdate(tx: Tx, orderId: string): Promise<VerificationPayment | null> {
    const [row] = await asDbTx(tx).select().from(payments).where(eq(payments.orderId, orderId)).for('update');
    return row ? toPayment(row) : null;
  }

  async insert(tx: Tx, payment: VerificationPayment): Promise<'inserted' | 'conflict'> {
    const s = payment.toState();
    try {
      await asDbTx(tx)
        .insert(payments)
        .values({
          id: s.id,
          orderId: s.orderId,
          userId: s.userId,
          amount: s.amount.amount,
          idempotencyKey: s.idempotencyKey,
          createdAt: s.createdAt,
          ...mutableColumns(payment),
        });
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);
      if (constraint !== null && INSERT_CONFLICTS.has(constraint)) return 'conflict';
      throw error;
    }
    await this.outbox.append(tx, payment.pullEvents());
    return 'inserted';
  }

  async save(tx: Tx, payment: VerificationPayment): Promise<void> {
    const updated = await asDbTx(tx)
      .update(payments)
      .set(mutableColumns(payment))
      .where(eq(payments.id, payment.id))
      .returning({ id: payments.id });
    if (updated.length !== 1) throw new Error(`billing.payments ${payment.id}: không tồn tại để cập nhật`);
    await this.outbox.append(tx, payment.pullEvents());
  }

  async attachCheckout(
    tx: Tx,
    paymentId: VerificationPaymentId,
    session: CheckoutSession,
  ): Promise<CheckoutSession> {
    const db = asDbTx(tx);
    await db
      .update(payments)
      .set({ checkoutUrl: session.checkoutUrl, qrData: session.qrData })
      .where(and(eq(payments.id, paymentId), isNull(payments.checkoutUrl)));
    const [row] = await db
      .select({ checkoutUrl: payments.checkoutUrl, qrData: payments.qrData })
      .from(payments)
      .where(eq(payments.id, paymentId));
    return (row && toCheckout(row)) ?? session;
  }
}

/** Hiện thực `VoucherRepository` (`billing.vouchers`). */
export class DrizzleVoucherRepository implements VoucherRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async insert(tx: Tx, voucher: Voucher): Promise<void> {
    const s = voucher.toState();
    await asDbTx(tx).insert(vouchers).values({
      id: s.id,
      userId: s.userId,
      paymentId: s.paymentId,
      value: s.value.amount,
      status: s.status,
      partnerId: s.partnerId,
      expiresAt: s.expiresAt,
      issuedAt: s.issuedAt,
      activatedAt: s.activatedAt,
      redeemedAt: s.redeemedAt,
      redeemedByPartnerId: s.redeemedByPartnerId,
      voidedAt: s.voidedAt,
      voidReason: s.voidReason,
      expiredAt: s.expiredAt,
      updatedAt: s.updatedAt,
      version: s.version,
    });
    await this.outbox.append(tx, voucher.pullEvents());
  }
}

/** Hiện thực `LedgerRepository` (`billing.ledger_entries`, chỉ INSERT — bảng có trigger chặn UPDATE/DELETE). */
export class DrizzleLedgerRepository implements LedgerRepository {
  async append(tx: Tx, entries: readonly LedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await asDbTx(tx)
      .insert(ledgerEntries)
      .values(
        entries.map((e) => ({
          id: e.id,
          type: e.type,
          amount: e.amount.amount,
          userId: e.userId,
          paymentId: e.paymentId,
          voucherId: e.voucherId,
          occurredAt: e.occurredAt,
        })),
      );
  }
}
