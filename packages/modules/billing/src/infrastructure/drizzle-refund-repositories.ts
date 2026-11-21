import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import { Money, type Tx } from '@tamgiao/kernel';
import { and, asc, eq, inArray, lte, type SQL } from 'drizzle-orm';
import type {
  PendingRefund,
  RefundPaymentRepository,
  RefundVoucherRepository,
} from '../application/ports/refund-repositories.js';
import {
  PAYMENT_STATUSES,
  VerificationPayment,
  type PaymentStatus,
  type VerificationPaymentId,
} from '../domain/verification-payment.js';
import { VOUCHER_STATUSES, Voucher, type VoucherId, type VoucherStatus } from '../domain/voucher.js';
import { DrizzleVerificationPaymentRepository } from './drizzle-payment-repositories.js';
import { payments, vouchers } from './schema.js';

type PaymentRow = typeof payments.$inferSelect;
type VoucherRow = typeof vouchers.$inferSelect;

const isPaymentStatus = (v: string): v is PaymentStatus =>
  (PAYMENT_STATUSES as readonly string[]).includes(v);
const isVoucherStatus = (v: string): v is VoucherStatus =>
  (VOUCHER_STATUSES as readonly string[]).includes(v);

function toPayment(row: PaymentRow): VerificationPayment {
  if (!isPaymentStatus(row.status))
    throw new Error(`billing.payments ${row.id}: status trong DB không hợp lệ`);
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

function toVoucher(row: VoucherRow): Voucher {
  if (!isVoucherStatus(row.status))
    throw new Error(`billing.vouchers ${row.id}: status trong DB không hợp lệ`);
  return Voucher.restore({
    id: row.id as VoucherId,
    userId: row.userId,
    paymentId: row.paymentId as VerificationPaymentId,
    value: Money.ofTrusted(row.value),
    status: row.status,
    partnerId: row.partnerId,
    expiresAt: row.expiresAt,
    issuedAt: row.issuedAt,
    activatedAt: row.activatedAt,
    redeemedAt: row.redeemedAt,
    redeemedByPartnerId: row.redeemedByPartnerId,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    expiredAt: row.expiredAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

/**
 * `RefundPaymentRepository` trên `billing.payments` (BE-S4-04). Ghi (`save`) uỷ quyền cho
 * `DrizzleVerificationPaymentRepository` để một nơi duy nhất quyết định cột cập nhật + outbox.
 */
export class DrizzleRefundPaymentRepository implements RefundPaymentRepository {
  private readonly writer: DrizzleVerificationPaymentRepository;

  constructor(outbox: OutboxWriter) {
    this.writer = new DrizzleVerificationPaymentRepository(outbox);
  }

  async findSucceededByUserForUpdate(tx: Tx, userId: string): Promise<VerificationPayment | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(payments)
      .where(and(eq(payments.userId, userId), eq(payments.status, 'SUCCEEDED')))
      .for('update');
    return row ? toPayment(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: VerificationPaymentId): Promise<VerificationPayment | null> {
    const [row] = await asDbTx(tx).select().from(payments).where(eq(payments.id, id)).for('update');
    return row ? toPayment(row) : null;
  }

  async findById(tx: Tx, id: VerificationPaymentId): Promise<VerificationPayment | null> {
    const [row] = await asDbTx(tx).select().from(payments).where(eq(payments.id, id));
    return row ? toPayment(row) : null;
  }

  async listRefundPending(
    tx: Tx,
    options: { readonly limit: number; readonly requestedAtOrBefore?: Date },
  ): Promise<PendingRefund[]> {
    const conditions: SQL[] = [eq(payments.status, 'REFUND_PENDING')];
    if (options.requestedAtOrBefore !== undefined) {
      conditions.push(lte(payments.refundRequestedAt, options.requestedAtOrBefore));
    }
    const rows = await asDbTx(tx)
      .select({ id: payments.id, refundRequestedAt: payments.refundRequestedAt })
      .from(payments)
      .where(and(...conditions))
      .orderBy(asc(payments.refundRequestedAt), asc(payments.id))
      .limit(options.limit);
    return rows.map((r) => {
      if (r.refundRequestedAt === null) {
        throw new Error(`billing.payments ${r.id}: REFUND_PENDING thiếu refund_requested_at`);
      }
      return { paymentId: r.id as VerificationPaymentId, refundRequestedAt: r.refundRequestedAt };
    });
  }

  save(tx: Tx, payment: VerificationPayment): Promise<void> {
    return this.writer.save(tx, payment);
  }
}

/** `RefundVoucherRepository` trên `billing.vouchers` (BE-S4-04). */
export class DrizzleRefundVoucherRepository implements RefundVoucherRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async findByPaymentIdForUpdate(tx: Tx, paymentId: VerificationPaymentId): Promise<Voucher | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(vouchers)
      .where(eq(vouchers.paymentId, paymentId))
      .for('update');
    return row ? toVoucher(row) : null;
  }

  async listOpenByUserForUpdate(tx: Tx, userId: string): Promise<Voucher[]> {
    const rows = await asDbTx(tx)
      .select()
      .from(vouchers)
      .where(and(eq(vouchers.userId, userId), inArray(vouchers.status, ['RESERVED', 'ACTIVE'])))
      .orderBy(asc(vouchers.issuedAt), asc(vouchers.id))
      .for('update');
    return rows.map(toVoucher);
  }

  async save(tx: Tx, voucher: Voucher): Promise<void> {
    const s = voucher.toState();
    const updated = await asDbTx(tx)
      .update(vouchers)
      .set({
        status: s.status,
        partnerId: s.partnerId,
        expiresAt: s.expiresAt,
        activatedAt: s.activatedAt,
        redeemedAt: s.redeemedAt,
        redeemedByPartnerId: s.redeemedByPartnerId,
        voidedAt: s.voidedAt,
        voidReason: s.voidReason,
        expiredAt: s.expiredAt,
        updatedAt: s.updatedAt,
        version: s.version,
      })
      .where(eq(vouchers.id, s.id))
      .returning({ id: vouchers.id });
    if (updated.length !== 1) throw new Error(`billing.vouchers ${s.id}: không tồn tại để cập nhật`);
    await this.outbox.append(tx, voucher.pullEvents());
  }
}
