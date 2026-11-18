import type { Tx } from '@tamgiao/kernel';
import type { BillingUserId } from '../../domain/verification-payment.js';
import type { Voucher, VoucherId } from '../../domain/voucher.js';

/**
 * Đọc / chuyển trạng thái voucher sau khi phát hành (BE-S4-05: kích hoạt, QR, đổi tại quán, hết hạn).
 * Tách khỏi `VoucherRepository` (chỉ `insert`, BE-S4-03) để không đụng port dùng chung.
 */
export interface VoucherLifecycleRepository {
  findById(tx: Tx, id: VoucherId): Promise<Voucher | null>;
  /** Khoá dòng tới hết `tx` (`SELECT … FOR UPDATE`) — các lượt đổi đồng thời của cùng voucher chạy tuần tự (A10). */
  findByIdForUpdate(tx: Tx, id: VoucherId): Promise<Voucher | null>;
  /** Voucher của người dùng, mới phát hành trước. */
  listByUser(tx: Tx, userId: BillingUserId): Promise<Voucher[]>;
  /**
   * Khoá tối đa `limit` voucher `RESERVED | ACTIVE` có `expires_at <= now` (`FOR UPDATE SKIP LOCKED`, cũ nhất trước) —
   * dòng đang bị transaction khác giữ (vd đang đổi) được bỏ qua, lượt sau xử lý.
   */
  lockDueForExpiry(tx: Tx, now: Date, limit: number): Promise<Voucher[]>;
  /** Ghi trạng thái mới của voucher đã có + event vào outbox cùng `tx` (A6). */
  save(tx: Tx, voucher: Voucher): Promise<void>;
}
