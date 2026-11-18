import {
  err,
  fail,
  newId,
  ok,
  type Clock,
  type DomainError,
  type Money,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import { LedgerEntry, type LedgerEntryError } from '../../domain/ledger-entry.js';
import type { VoucherId, VoucherPartnerId, VoucherRedeemError } from '../../domain/voucher.js';
import type { LedgerRepository } from '../ports/payment-repositories.js';
import type { VoucherLifecycleRepository } from '../ports/voucher-lifecycle-repository.js';
import type { VoucherQrTokenService } from '../ports/voucher-qr-token-service.js';

export interface RedeemVoucherDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly vouchers: VoucherLifecycleRepository;
  readonly ledger: LedgerRepository;
  readonly tokens: VoucherQrTokenService;
}

export interface RedeemVoucherCommand {
  /** Token đọc từ mã QR của người dùng. */
  readonly token: string;
  /** Quán của nhân viên đang đăng nhập (từ token partner). */
  readonly partnerId: VoucherPartnerId;
}

export interface RedeemedVoucher {
  readonly voucherId: VoucherId;
  readonly value: Money;
  readonly redeemedAt: Date;
}

export type RedeemVoucherError =
  VoucherRedeemError | LedgerEntryError | DomainError<'VOUCHER_TOKEN_INVALID' | 'VOUCHER_NOT_FOUND'>;

/**
 * Nhân viên quán đổi voucher (`POST /partner/vouchers/redeem`, BE-S4-05).
 * Token sai/bị sửa/hết hạn → `VOUCHER_TOKEN_INVALID`, không mở transaction. Còn lại trong **một transaction**:
 * khoá dòng voucher (`SELECT … FOR UPDATE`) → `redeem(partnerId, now)` (ACTIVE, chưa quá hạn, đúng quán nếu đã gắn)
 * → lưu + event `VoucherRedeemed` qua outbox → ledger `VOUCHER_REDEEM`.
 * Quét lần 2 (tuần tự hoặc đồng thời — lượt sau chờ khoá rồi thấy `REDEEMED`) → `VOUCHER_ALREADY_REDEEMED`; thêm lớp
 * bảo vệ ở DB: unique ledger `(voucher_id, type)` (A10).
 */
export class RedeemVoucher {
  constructor(private readonly deps: RedeemVoucherDeps) {}

  async execute(cmd: RedeemVoucherCommand): Promise<Result<RedeemedVoucher, RedeemVoucherError>> {
    const verified = this.deps.tokens.verify(cmd.token, this.deps.clock.now());
    if (verified.isErr()) return err(verified.error);
    const voucherId = verified.value;

    return this.deps.uow.run(async (tx) => {
      const voucher = await this.deps.vouchers.findByIdForUpdate(tx, voucherId);
      if (voucher === null) return fail('VOUCHER_NOT_FOUND');
      const now = this.deps.clock.now();
      const redeemed = voucher.redeem(cmd.partnerId, now);
      if (redeemed.isErr()) return err(redeemed.error);

      const entry = LedgerEntry.create({
        id: newId<'LedgerEntry'>(),
        type: 'VOUCHER_REDEEM',
        amount: voucher.value,
        userId: voucher.userId,
        paymentId: voucher.paymentId,
        voucherId: voucher.id,
        occurredAt: now,
      });
      if (entry.isErr()) return err(entry.error);

      await this.deps.vouchers.save(tx, voucher);
      await this.deps.ledger.append(tx, [entry.value]);
      return ok({ voucherId: voucher.id, value: voucher.value, redeemedAt: now });
    });
  }
}
