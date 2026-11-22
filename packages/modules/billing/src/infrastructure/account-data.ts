import { ACCOUNT_DELETION_REQUESTED } from '@tamgiao/contracts';
import { asDbTx, OutboxWriter, type EventBus } from '@tamgiao/db';
import { newId, type Clock, type DomainEvent, type Tx } from '@tamgiao/kernel';
import type { PersonalDataSection, PersonalDataSource } from '@tamgiao/module-identity/facade';
import { asc, eq } from 'drizzle-orm';
import { LedgerEntry } from '../domain/ledger-entry.js';
import type { BillingUserId } from '../domain/verification-payment.js';
import { DrizzleLedgerRepository } from './drizzle-payment-repositories.js';
import { DrizzleVoucherLifecycleRepository } from './drizzle-voucher-repository.js';
import { payments, vouchers } from './schema.js';

/**
 * Quyền dữ liệu cá nhân của module billing (BE-S7-06). Sổ cái, khoản thanh toán, voucher là chứng từ kế toán phải giữ
 * → **không xoá**: sau khi các module khác xoá PII, `user_id` chỉ còn là một UUID không liên kết được tới danh tính
 * (identity đã xoá SĐT). Billing chỉ xoá phần phiên thanh toán của cổng (URL/QR) và huỷ voucher còn hiệu lực.
 */

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const BILLING_ERASE_ON_ACCOUNT_DELETION_CONSUMER = 'billing.erase-on-account-deletion';

/** Mã lý do huỷ voucher khi chủ voucher xoá tài khoản (không PII). */
export const ACCOUNT_DELETED_VOUCHER_VOID_REASON = 'ACCOUNT_DELETED';

function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

/**
 * `AccountDeletionRequested` → (1) voucher `RESERVED | ACTIVE` → `VOID('ACCOUNT_DELETED')` + ledger `VOUCHER_VOID` (giữ
 * đối soát `VOUCHER_VOID_COUNT` khớp), `VoucherVoided` vào outbox; (2) xoá `checkout_url`/`qr_data` của mọi khoản.
 * Ledger, payment, voucher còn nguyên. Idempotent (A9): voucher đã `VOID` không bị huỷ lại (khoá `FOR UPDATE` + kiểm tra
 * lại trạng thái), cột đã NULL ghi lại vẫn NULL.
 */
export function registerBillingAccountDeletionConsumer(bus: EventBus, deps: { readonly clock: Clock }): void {
  const vouchersRepo = new DrizzleVoucherLifecycleRepository(new OutboxWriter());
  const ledger = new DrizzleLedgerRepository();
  bus.on(ACCOUNT_DELETION_REQUESTED, BILLING_ERASE_ON_ACCOUNT_DELETION_CONSUMER, async (event, tx) => {
    const userId = userIdOf(event);
    const now = deps.clock.now();
    for (const listed of await vouchersRepo.listByUser(tx, userId as BillingUserId)) {
      if (!listed.isOpen) continue;
      const voucher = await vouchersRepo.findByIdForUpdate(tx, listed.id);
      if (!voucher?.isOpen) continue;
      const voided = voucher.void(ACCOUNT_DELETED_VOUCHER_VOID_REASON, now);
      if (voided.isErr()) throw new Error(`${BILLING_ERASE_ON_ACCOUNT_DELETION_CONSUMER}: ${voided.error.code}`);
      const entry = LedgerEntry.create({
        id: newId<'LedgerEntry'>(),
        type: 'VOUCHER_VOID',
        amount: voucher.value,
        userId: voucher.userId,
        paymentId: voucher.paymentId,
        voucherId: voucher.id,
        occurredAt: now,
      });
      if (entry.isErr()) throw new Error(`${BILLING_ERASE_ON_ACCOUNT_DELETION_CONSUMER}: ${entry.error.code}`);
      await vouchersRepo.save(tx, voucher);
      await ledger.append(tx, [entry.value]);
    }
    await asDbTx(tx)
      .update(payments)
      .set({ checkoutUrl: null, qrData: null })
      .where(eq(payments.userId, userId));
  });
}

/** Mục `billing` của file xuất: các khoản thanh toán + voucher của chính chủ (tiền dạng chuỗi số nguyên VND). */
export function createBillingPersonalDataSource(): PersonalDataSource {
  return {
    section: 'billing',
    async collect(tx: Tx, userId: string): Promise<PersonalDataSection> {
      const db = asDbTx(tx);
      const paid = await db
        .select()
        .from(payments)
        .where(eq(payments.userId, userId))
        .orderBy(asc(payments.createdAt));
      const owned = await db
        .select()
        .from(vouchers)
        .where(eq(vouchers.userId, userId))
        .orderBy(asc(vouchers.issuedAt));
      return {
        data: {
          payments: paid.map((p) => ({
            orderId: p.orderId,
            amountVnd: p.amount.toString(),
            status: p.status,
            createdAt: p.createdAt.toISOString(),
            succeededAt: p.succeededAt?.toISOString() ?? null,
            refundedAt: p.refundedAt?.toISOString() ?? null,
          })),
          vouchers: owned.map((v) => ({
            valueVnd: v.value.toString(),
            status: v.status,
            issuedAt: v.issuedAt.toISOString(),
            expiresAt: v.expiresAt?.toISOString() ?? null,
            redeemedAt: v.redeemedAt?.toISOString() ?? null,
          })),
        },
        files: [],
      };
    },
  };
}
