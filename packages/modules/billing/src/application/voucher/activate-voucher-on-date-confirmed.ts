import { err, ok, type Clock, type Result, type Tx } from '@tamgiao/kernel';
import type { BillingUserId } from '../../domain/verification-payment.js';
import type { VoucherId, VoucherTransitionError } from '../../domain/voucher.js';
import type { RefundVoucherRepository } from '../ports/refund-repositories.js';

export interface ActivateVoucherOnDateConfirmedCommand {
  /** Người nhận voucher — người mời của lịch hẹn (`DateConfirmed.inviterId`, mặc định tạm khi D1 chưa chốt). */
  readonly userId: BillingUserId;
}

/**
 * Kết quả một lần xử lý (để log, không phải lỗi):
 * - `ACTIVATED`: voucher `RESERVED → ACTIVE`, `VoucherActivated` vào outbox.
 * - `ALREADY_ACTIVE`: người dùng đã có voucher `ACTIVE` (event giao lại, hoặc lịch trước đã xác nhận rồi bị huỷ) → no-op.
 * - `NO_VOUCHER`: không có voucher `RESERVED | ACTIVE` (chưa thanh toán, đã hoàn tiền, đã đổi / hết hạn) → no-op.
 * - `VOUCHER_EXPIRED`: voucher `RESERVED` đã quá hạn dùng (job hết hạn chưa chạy tới) → no-op, job hết hạn xử lý.
 */
export type ActivateVoucherOnDateConfirmedOutcome =
  | { readonly kind: 'ACTIVATED' | 'ALREADY_ACTIVE' | 'VOUCHER_EXPIRED'; readonly voucherId: VoucherId }
  | { readonly kind: 'NO_VOUCHER' };

export interface ActivateVoucherOnDateConfirmedDeps {
  readonly clock: Clock;
  readonly vouchers: RefundVoucherRepository;
}

/**
 * Consumer `DateConfirmed` (dating, BE-S7-01; consumer `billing.activate-voucher-on-date-confirmed`): kích hoạt voucher
 * hẹn hò của người mời. Chạy trong transaction của `deliverOnce` (cùng `processed_events`), khoá voucher mở của người
 * dùng `FOR UPDATE` rồi để domain `activate(now)` kiểm tra luật (đã có hạn dùng, chưa quá hạn).
 *
 * Idempotent (A9) hai lớp: `processed_events` + kiểm tra lại trạng thái (đã `ACTIVE` → no-op). Voucher chưa có hạn
 * dùng (`expiry_not_set` — consumer `KycApproved` chưa chạy) → `Err` để consumer throw, hàng đợi thử lại.
 */
export class ActivateVoucherOnDateConfirmed {
  constructor(private readonly deps: ActivateVoucherOnDateConfirmedDeps) {}

  async handle(
    tx: Tx,
    cmd: ActivateVoucherOnDateConfirmedCommand,
  ): Promise<Result<ActivateVoucherOnDateConfirmedOutcome, VoucherTransitionError>> {
    const vouchers = await this.deps.vouchers.listOpenByUserForUpdate(tx, cmd.userId);
    const active = vouchers.find((v) => v.status === 'ACTIVE');
    if (active !== undefined) return ok({ kind: 'ALREADY_ACTIVE', voucherId: active.id });
    const reserved = vouchers.find((v) => v.status === 'RESERVED');
    if (reserved === undefined) return ok({ kind: 'NO_VOUCHER' });

    const activated = reserved.activate(this.deps.clock.now());
    if (activated.isErr()) {
      if (activated.error.code === 'VOUCHER_EXPIRED') {
        return ok({ kind: 'VOUCHER_EXPIRED', voucherId: reserved.id });
      }
      return err(activated.error);
    }
    await this.deps.vouchers.save(tx, reserved);
    return ok({ kind: 'ACTIVATED', voucherId: reserved.id });
  }
}
