import type { Tx } from '@tamgiao/kernel';
import type {
  BillingUserId,
  VerificationPayment,
  VerificationPaymentId,
} from '../../domain/verification-payment.js';
import type { Voucher } from '../../domain/voucher.js';

/** Khoản đang chờ gọi cổng hoàn tiền (`REFUND_PENDING`). */
export interface PendingRefund {
  readonly paymentId: VerificationPaymentId;
  readonly refundRequestedAt: Date;
}

/**
 * Truy cập `billing.payments` cho luồng hoàn tiền (BE-S4-04). Tách khỏi `VerificationPaymentRepository` để luồng
 * hoàn tiền không đụng file dùng chung với task khác; hiện thực Drizzle lưu bằng cùng cách (`save` + outbox).
 */
export interface RefundPaymentRepository {
  /** Khoản `SUCCEEDED` của người dùng, khoá dòng (`SELECT … FOR UPDATE`). DB bảo đảm tối đa một khoản như vậy. */
  findSucceededByUserForUpdate(tx: Tx, userId: BillingUserId): Promise<VerificationPayment | null>;
  /** Khoá dòng theo id (`SELECT … FOR UPDATE`). */
  findByIdForUpdate(tx: Tx, id: VerificationPaymentId): Promise<VerificationPayment | null>;
  /** Đọc không khoá (dùng trước khi gọi cổng — không giữ khoá/connection khi chờ mạng). */
  findById(tx: Tx, id: VerificationPaymentId): Promise<VerificationPayment | null>;
  /** Khoản `REFUND_PENDING`, yêu cầu hoàn sớm nhất trước. `requestedAtOrBefore` → chỉ khoản yêu cầu tại/trước mốc đó. */
  listRefundPending(
    tx: Tx,
    options: { readonly limit: number; readonly requestedAtOrBefore?: Date },
  ): Promise<PendingRefund[]>;
  /** Ghi trạng thái mới + event vào outbox (A6). */
  save(tx: Tx, payment: VerificationPayment): Promise<void>;
}

/** Truy cập `billing.vouchers` cho luồng hoàn tiền + đặt hạn voucher khi hồ sơ được duyệt. */
export interface RefundVoucherRepository {
  /** Voucher sinh từ khoản thanh toán (`payment_id` unique), khoá dòng. */
  findByPaymentIdForUpdate(tx: Tx, paymentId: VerificationPaymentId): Promise<Voucher | null>;
  /** Voucher `RESERVED | ACTIVE` của người dùng, khoá dòng. */
  listOpenByUserForUpdate(tx: Tx, userId: BillingUserId): Promise<Voucher[]>;
  /** Ghi trạng thái mới + event vào outbox (A6). */
  save(tx: Tx, voucher: Voucher): Promise<void>;
}
