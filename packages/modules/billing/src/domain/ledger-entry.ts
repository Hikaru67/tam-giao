import { Entity, fail, ok, type DomainError, type Id, type Money, type Result } from '@tamgiao/kernel';
import type { BillingUserId, VerificationPaymentId } from './verification-payment.js';
import type { VoucherId } from './voucher.js';

export type LedgerEntryId = Id<'LedgerEntry'>;

/**
 * Loại bút toán. `CHARGE`/`REFUND` gắn với khoản thanh toán; `VOUCHER_*` gắn với voucher.
 * Số tiền luôn dương — chiều tiền (vào/ra) suy ra từ `type`.
 */
export const LEDGER_ENTRY_TYPES = [
  'CHARGE',
  'REFUND',
  'VOUCHER_ISSUE',
  'VOUCHER_REDEEM',
  'VOUCHER_VOID',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

const PAYMENT_TYPES: readonly LedgerEntryType[] = ['CHARGE', 'REFUND'];

export type LedgerEntryError = DomainError<'LEDGER_AMOUNT_INVALID' | 'LEDGER_REFERENCE_REQUIRED'>;

export interface LedgerEntryProps {
  readonly id: LedgerEntryId;
  readonly type: LedgerEntryType;
  readonly amount: Money;
  readonly userId: BillingUserId;
  readonly paymentId: VerificationPaymentId | null;
  readonly voucherId: VoucherId | null;
  readonly occurredAt: Date;
}

/**
 * Bút toán sổ cái — **bất biến, chỉ tạo** (bảng `ledger_entries` chỉ ghi thêm, AGENTS.md mục 4).
 * Không có method thay đổi; điều chỉnh sai sót bằng bút toán mới.
 */
export class LedgerEntry extends Entity<LedgerEntryId> {
  readonly type: LedgerEntryType;
  readonly amount: Money;
  readonly userId: BillingUserId;
  readonly paymentId: VerificationPaymentId | null;
  readonly voucherId: VoucherId | null;
  readonly occurredAt: Date;

  private constructor(props: LedgerEntryProps) {
    super(props.id);
    this.type = props.type;
    this.amount = props.amount;
    this.userId = props.userId;
    this.paymentId = props.paymentId;
    this.voucherId = props.voucherId;
    this.occurredAt = new Date(props.occurredAt.getTime());
    Object.freeze(this);
  }

  /**
   * Tạo bút toán mới. Số tiền phải > 0; `CHARGE`/`REFUND` bắt buộc `paymentId`, `VOUCHER_*` bắt buộc `voucherId`.
   */
  static create(props: LedgerEntryProps): Result<LedgerEntry, LedgerEntryError> {
    if (props.amount.isZero()) return fail('LEDGER_AMOUNT_INVALID', { type: props.type });
    if (PAYMENT_TYPES.includes(props.type)) {
      if (props.paymentId === null)
        return fail('LEDGER_REFERENCE_REQUIRED', { type: props.type, field: 'paymentId' });
    } else if (props.voucherId === null) {
      return fail('LEDGER_REFERENCE_REQUIRED', { type: props.type, field: 'voucherId' });
    }
    return ok(new LedgerEntry(props));
  }

  /** Dựng lại từ DB (dữ liệu đã được kiểm tra khi tạo). */
  static restore(props: LedgerEntryProps): LedgerEntry {
    return new LedgerEntry(props);
  }

  toProps(): LedgerEntryProps {
    return {
      id: this.id,
      type: this.type,
      amount: this.amount,
      userId: this.userId,
      paymentId: this.paymentId,
      voucherId: this.voucherId,
      occurredAt: new Date(this.occurredAt.getTime()),
    };
  }
}
