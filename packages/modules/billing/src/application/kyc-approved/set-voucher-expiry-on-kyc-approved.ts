import { err, ok, type Clock, type Result, type Tx } from '@tamgiao/kernel';
import type { BillingUserId } from '../../domain/verification-payment.js';
import type { VoucherTransitionError } from '../../domain/voucher.js';
import type { RefundVoucherRepository } from '../ports/refund-repositories.js';

export interface SetVoucherExpiryCommand {
  readonly userId: BillingUserId;
  /** Thời điểm hồ sơ được duyệt = `occurredAt` của event `KycApproved`. */
  readonly approvedAt: Date;
}

export interface SetVoucherExpiryOutcome {
  /** Số voucher vừa được đặt hạn (0 khi không có voucher hoặc đã có hạn — event lặp lại). */
  readonly updated: number;
}

export interface SetVoucherExpiryOnKycApprovedDeps {
  readonly clock: Clock;
  readonly vouchers: RefundVoucherRepository;
}

/**
 * Consumer `KycApproved` (consumer `billing.set-voucher-expiry`): voucher `RESERVED | ACTIVE` của người dùng chưa có
 * hạn → hạn = `approvedAt + VOUCHER_TTL_DAYS`. `approvedAt` lấy từ `occurredAt` của event (đúng "ngày hồ sơ được
 * duyệt", không lệch theo độ trễ relay/retry); `clock.now()` chỉ dùng cho `updatedAt`. Idempotent: voucher đã có hạn
 * → bỏ qua; không có voucher → không làm gì. Chạy trong transaction của `deliverOnce`, khoá voucher `FOR UPDATE`.
 */
export class SetVoucherExpiryOnKycApproved {
  constructor(private readonly deps: SetVoucherExpiryOnKycApprovedDeps) {}

  async handle(
    tx: Tx,
    cmd: SetVoucherExpiryCommand,
  ): Promise<Result<SetVoucherExpiryOutcome, VoucherTransitionError>> {
    const vouchers = await this.deps.vouchers.listOpenByUserForUpdate(tx, cmd.userId);
    const now = this.deps.clock.now();
    let updated = 0;
    for (const voucher of vouchers) {
      if (voucher.expiresAt !== null) continue;
      const set = voucher.setExpiryFromApproval(cmd.approvedAt, now);
      if (set.isErr()) return err(set.error);
      await this.deps.vouchers.save(tx, voucher);
      updated++;
    }
    return ok({ updated });
  }
}
