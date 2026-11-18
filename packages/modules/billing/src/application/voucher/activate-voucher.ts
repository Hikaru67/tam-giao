import { err, fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { VoucherId, VoucherTransitionError } from '../../domain/voucher.js';
import type { VoucherLifecycleRepository } from '../ports/voucher-lifecycle-repository.js';
import { toVoucherView, type VoucherView } from './voucher-views.js';

export interface ActivateVoucherDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly vouchers: VoucherLifecycleRepository;
}

export interface ActivateVoucherCommand {
  readonly voucherId: VoucherId;
}

export type ActivateVoucherError = VoucherTransitionError | DomainError<'VOUCHER_NOT_FOUND'>;

/**
 * Kích hoạt voucher `RESERVED → ACTIVE` (BE-S4-05). Sẽ được consumer `DateConfirmed` (S7) gọi — chưa có route public.
 * Khoá dòng voucher, kiểm tra luật domain (đã có hạn dùng, chưa quá hạn), lưu + event `VoucherActivated` qua outbox.
 * Gọi lại khi đã `ACTIVE` → `VOUCHER_INVALID_TRANSITION` (consumer coi là đã xử lý).
 */
export class ActivateVoucher {
  constructor(private readonly deps: ActivateVoucherDeps) {}

  async execute(cmd: ActivateVoucherCommand): Promise<Result<VoucherView, ActivateVoucherError>> {
    return this.deps.uow.run(async (tx) => {
      const voucher = await this.deps.vouchers.findByIdForUpdate(tx, cmd.voucherId);
      if (voucher === null) return fail('VOUCHER_NOT_FOUND');
      const activated = voucher.activate(this.deps.clock.now());
      if (activated.isErr()) return err(activated.error);
      await this.deps.vouchers.save(tx, voucher);
      return ok(toVoucherView(voucher));
    });
  }
}
