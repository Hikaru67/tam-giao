import type { Tx } from '@tamgiao/kernel';
import type { LedgerEntry } from '../../domain/ledger-entry.js';
import type {
  BillingUserId,
  VerificationPayment,
  VerificationPaymentId,
} from '../../domain/verification-payment.js';
import type { Voucher } from '../../domain/voucher.js';
import type { CheckoutSession } from './payment-gateway.js';

/** Khoản thanh toán kèm phiên thanh toán của cổng đã lưu (`null` khi chưa tạo được phiên). */
export interface StoredPayment {
  readonly payment: VerificationPayment;
  readonly checkout: CheckoutSession | null;
}

/**
 * Lưu trữ khoản thanh toán xác thực (`billing.payments`). Ràng buộc DB: `order_id`, `gateway_txn_id`,
 * `(user_id, idempotency_key)` unique; mỗi người dùng tối đa 1 khoản `PENDING | SUCCEEDED` (partial unique index).
 */
export interface VerificationPaymentRepository {
  findByUserAndIdempotencyKey(
    tx: Tx,
    userId: BillingUserId,
    idempotencyKey: string,
  ): Promise<StoredPayment | null>;
  /** Mọi khoản của người dùng, mới nhất trước. */
  listByUser(tx: Tx, userId: BillingUserId): Promise<StoredPayment[]>;
  /** Khoá dòng theo mã đơn (`SELECT … FOR UPDATE`) — webhook đồng thời của cùng đơn chạy tuần tự. */
  findByOrderIdForUpdate(tx: Tx, orderId: string): Promise<VerificationPayment | null>;
  /**
   * Thêm khoản mới. Vi phạm unique (trùng idempotency key / đã có khoản `PENDING | SUCCEEDED`) → `'conflict'`;
   * khi đó transaction Postgres đã hỏng, use case phải trả `Err` để rollback rồi đọc lại trong transaction mới.
   */
  insert(tx: Tx, payment: VerificationPayment): Promise<'inserted' | 'conflict'>;
  /** Ghi trạng thái mới của khoản đã có + event vào outbox (A6). */
  save(tx: Tx, payment: VerificationPayment): Promise<void>;
  /** Lưu phiên thanh toán nếu khoản chưa có phiên; trả về phiên đang lưu (của lần ghi thắng). */
  attachCheckout(
    tx: Tx,
    paymentId: VerificationPaymentId,
    session: CheckoutSession,
  ): Promise<CheckoutSession>;
}

/** Lưu trữ voucher (`billing.vouchers`, `payment_id` unique). */
export interface VoucherRepository {
  /** Thêm voucher mới + event vào outbox (A6). */
  insert(tx: Tx, voucher: Voucher): Promise<void>;
}

/** Sổ cái chỉ ghi thêm (`billing.ledger_entries`). */
export interface LedgerRepository {
  append(tx: Tx, entries: readonly LedgerEntry[]): Promise<void>;
}
