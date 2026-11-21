import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import { Money, type Tx } from '@tamgiao/kernel';
import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import type { VoucherLifecycleRepository } from '../application/ports/voucher-lifecycle-repository.js';
import type { VerificationPaymentId } from '../domain/verification-payment.js';
import { VOUCHER_STATUSES, Voucher, type VoucherId, type VoucherStatus } from '../domain/voucher.js';
import { vouchers } from './schema.js';

type VoucherRow = typeof vouchers.$inferSelect;

const isStatus = (v: string): v is VoucherStatus => (VOUCHER_STATUSES as readonly string[]).includes(v);

function toVoucher(row: VoucherRow): Voucher {
  if (!isStatus(row.status)) throw new Error(`billing.vouchers ${row.id}: status trong DB không hợp lệ`);
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

/** Trạng thái còn có thể hết hạn. */
const EXPIRABLE: readonly VoucherStatus[] = ['RESERVED', 'ACTIVE'];

/** Hiện thực `VoucherLifecycleRepository` bằng Drizzle + PostgreSQL (`billing.vouchers`). */
export class DrizzleVoucherLifecycleRepository implements VoucherLifecycleRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async findById(tx: Tx, id: VoucherId): Promise<Voucher | null> {
    const [row] = await asDbTx(tx).select().from(vouchers).where(eq(vouchers.id, id));
    return row ? toVoucher(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: VoucherId): Promise<Voucher | null> {
    const [row] = await asDbTx(tx).select().from(vouchers).where(eq(vouchers.id, id)).for('update');
    return row ? toVoucher(row) : null;
  }

  async listByUser(tx: Tx, userId: string): Promise<Voucher[]> {
    const rows = await asDbTx(tx)
      .select()
      .from(vouchers)
      .where(eq(vouchers.userId, userId))
      .orderBy(desc(vouchers.issuedAt), desc(vouchers.id));
    return rows.map(toVoucher);
  }

  async lockDueForExpiry(tx: Tx, now: Date, limit: number): Promise<Voucher[]> {
    // Dùng index (status, expires_at); `expires_at` NULL không thoả `<=` nên voucher chưa có hạn không bị chọn.
    const rows = await asDbTx(tx)
      .select()
      .from(vouchers)
      .where(and(inArray(vouchers.status, [...EXPIRABLE]), lte(vouchers.expiresAt, now)))
      .orderBy(asc(vouchers.expiresAt), asc(vouchers.id))
      .limit(limit)
      .for('update', { skipLocked: true });
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
      .where(eq(vouchers.id, voucher.id))
      .returning({ id: vouchers.id });
    if (updated.length !== 1) throw new Error(`billing.vouchers ${voucher.id}: không tồn tại để cập nhật`);
    await this.outbox.append(tx, voucher.pullEvents());
  }
}
