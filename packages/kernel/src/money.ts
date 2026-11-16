import { fail, type DomainError } from './domain-error.js';
import { ok, type Result } from './result.js';

export type MoneyError = DomainError<'MONEY_INVALID' | 'MONEY_NEGATIVE'>;

/**
 * Số tiền VND, luôn là số nguyên không âm (VND không có đơn vị lẻ). Lưu `bigint` để khớp cột `bigint`
 * trong DB và không bao giờ dùng số thực (AGENTS.md A8).
 */
export class Money {
  static readonly CURRENCY = 'VND';
  static readonly ZERO = new Money(0n);

  private constructor(readonly amount: bigint) {}

  static of(amount: number | bigint): Result<Money, MoneyError> {
    if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
      return fail('MONEY_INVALID', { reason: 'not_safe_integer' });
    }
    const value = BigInt(amount);
    if (value < 0n) return fail('MONEY_NEGATIVE');
    return ok(new Money(value));
  }

  /** Dùng cho hằng số tin cậy (vd `DEPOSIT_VND`). Giá trị sai là lỗi lập trình → throw. */
  static ofTrusted(amount: number | bigint): Money {
    const result = Money.of(amount);
    if (result.isErr()) throw new Error(`Số tiền không hợp lệ: ${String(amount)} (${result.error.code})`);
    return result.value;
  }

  add(other: Money): Money {
    return new Money(this.amount + other.amount);
  }

  subtract(other: Money): Result<Money, MoneyError> {
    return Money.of(this.amount - other.amount);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount;
  }

  compare(other: Money): -1 | 0 | 1 {
    if (this.amount === other.amount) return 0;
    return this.amount < other.amount ? -1 : 1;
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  toString(): string {
    return `${this.amount.toString()} ${Money.CURRENCY}`;
  }
}
