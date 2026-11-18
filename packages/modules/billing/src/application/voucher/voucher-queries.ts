import { fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { BillingUserId } from '../../domain/verification-payment.js';
import type { Voucher } from '../../domain/voucher.js';
import { VOUCHER_QR_TOKEN_TTL_SECONDS } from '../../domain/voucher-qr.js';
import type { VoucherLifecycleRepository } from '../ports/voucher-lifecycle-repository.js';
import type { IssuedVoucherQrToken, VoucherQrTokenService } from '../ports/voucher-qr-token-service.js';
import { toVoucherId, toVoucherView, type VoucherView } from './voucher-views.js';

export interface ListMyVouchersDeps {
  readonly uow: UnitOfWork;
  readonly vouchers: VoucherLifecycleRepository;
}

/** `GET /me/vouchers`: voucher của người dùng đang đăng nhập (BE-S4-05). */
export class ListMyVouchers {
  constructor(private readonly deps: ListMyVouchersDeps) {}

  async execute(userId: BillingUserId): Promise<readonly VoucherView[]> {
    const result = await this.deps.uow.run(async (tx) => ok(await this.deps.vouchers.listByUser(tx, userId)));
    return result.unwrapOr([]).map(toVoucherView);
  }
}

export interface GetVoucherQrDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly vouchers: VoucherLifecycleRepository;
  readonly tokens: VoucherQrTokenService;
}

export interface GetVoucherQrCommand {
  readonly userId: BillingUserId;
  /** Id lấy từ path — chưa kiểm tra định dạng. */
  readonly voucherId: string;
}

export type GetVoucherQrError = DomainError<
  'VOUCHER_NOT_FOUND' | 'VOUCHER_NOT_ACTIVE' | 'VOUCHER_ALREADY_REDEEMED' | 'VOUCHER_EXPIRED'
>;

/** Lý do voucher không đổi được tại thời điểm `now` (cùng thứ tự kiểm tra với `Voucher.redeem`), `null` = đổi được. */
function unusableReason(voucher: Voucher, now: Date): GetVoucherQrError['code'] | null {
  switch (voucher.status) {
    case 'REDEEMED':
      return 'VOUCHER_ALREADY_REDEEMED';
    case 'EXPIRED':
      return 'VOUCHER_EXPIRED';
    case 'RESERVED':
    case 'VOID':
      return 'VOUCHER_NOT_ACTIVE';
    case 'ACTIVE':
      return voucher.isPastExpiry(now) ? 'VOUCHER_EXPIRED' : null;
  }
}

/**
 * `GET /me/vouchers/:id/qr` (BE-S4-05): cấp token QR ngắn hạn (`VOUCHER_QR_TOKEN_TTL_SECONDS`) cho chủ voucher khi
 * voucher đang `ACTIVE` và chưa quá hạn. Voucher của người khác → `VOUCHER_NOT_FOUND` (không lộ sự tồn tại).
 * Chỉ đọc — không khoá dòng; việc đổi kiểm tra lại toàn bộ luật trong transaction riêng.
 */
export class GetVoucherQr {
  constructor(private readonly deps: GetVoucherQrDeps) {}

  async execute(cmd: GetVoucherQrCommand): Promise<Result<IssuedVoucherQrToken, GetVoucherQrError>> {
    const id = toVoucherId(cmd.voucherId);
    if (id === null) return fail('VOUCHER_NOT_FOUND');
    return this.deps.uow.run(async (tx) => {
      const voucher = await this.deps.vouchers.findById(tx, id);
      if (voucher === null || voucher.userId !== cmd.userId) return fail('VOUCHER_NOT_FOUND');
      const now = this.deps.clock.now();
      const reason = unusableReason(voucher, now);
      if (reason !== null) return fail(reason, { status: voucher.status });
      return ok(this.deps.tokens.issue(voucher.id, now, VOUCHER_QR_TOKEN_TTL_SECONDS));
    });
  }
}
