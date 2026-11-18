import { parseId, type Money } from '@tamgiao/kernel';
import type { Voucher, VoucherId, VoucherPartnerId, VoucherStatus } from '../../domain/voucher.js';

/** Thông tin voucher trả cho chủ voucher (thẻ voucher màn 6, 11, 12). */
export interface VoucherView {
  readonly id: VoucherId;
  readonly status: VoucherStatus;
  readonly value: Money;
  readonly expiresAt: Date | null;
  readonly partnerId: VoucherPartnerId | null;
  readonly issuedAt: Date;
  readonly activatedAt: Date | null;
  readonly redeemedAt: Date | null;
}

export function toVoucherView(voucher: Voucher): VoucherView {
  const s = voucher.toState();
  return {
    id: s.id,
    status: s.status,
    value: s.value,
    expiresAt: s.expiresAt,
    partnerId: s.partnerId,
    issuedAt: s.issuedAt,
    activatedAt: s.activatedAt,
    redeemedAt: s.redeemedAt,
  };
}

/** Id voucher từ tham số ngoài (path) — không phải UUID v7 → `null` (caller trả `VOUCHER_NOT_FOUND`). */
export function toVoucherId(raw: string): VoucherId | null {
  const id = parseId<'Voucher'>(raw);
  return id.isOk() ? id.value : null;
}
