import { describe, expect, it } from 'vitest';
import { Money } from '../money.js';

describe('Money', () => {
  it('299.000 + 1.000 = 300.000 (AC2)', () => {
    const r = Money.of(299_000).andThen((a) => Money.of(1_000).map((b) => a.add(b)));
    expect(r.isOk() && r.value.amount).toBe(300_000n);
  });

  it('nhận bigint', () => {
    const r = Money.of(9_007_199_254_740_993n);
    expect(r.isOk() && r.value.amount).toBe(9_007_199_254_740_993n);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'từ chối số không phải số nguyên an toàn: %s',
    (n) => {
      const r = Money.of(n);
      expect(r.isErr() && r.error.code).toBe('MONEY_INVALID');
    },
  );

  it('từ chối số âm (AC2)', () => {
    expect(Money.of(-1).isErr()).toBe(true);
    const r = Money.of(-1n);
    expect(r.isErr() && r.error.code).toBe('MONEY_NEGATIVE');
  });

  it('subtract: kết quả âm trả MONEY_NEGATIVE, không âm thì Ok', () => {
    const a = Money.ofTrusted(300_000);
    const b = Money.ofTrusted(299_000);
    expect(a.subtract(b).isOk() && a.subtract(b).unwrapOr(Money.ZERO).amount).toBe(1_000n);
    const neg = b.subtract(a);
    expect(neg.isErr() && neg.error.code).toBe('MONEY_NEGATIVE');
  });

  it('equals, compare, isZero, toString', () => {
    const a = Money.ofTrusted(100);
    const b = Money.ofTrusted(200);
    expect(a.equals(Money.ofTrusted(100))).toBe(true);
    expect(a.equals(b)).toBe(false);
    expect(a.compare(b)).toBe(-1);
    expect(b.compare(a)).toBe(1);
    expect(a.compare(Money.ofTrusted(100))).toBe(0);
    expect(Money.ZERO.isZero()).toBe(true);
    expect(a.isZero()).toBe(false);
    expect(Money.ofTrusted(300_000).toString()).toBe('300000 VND');
    expect(Money.CURRENCY).toBe('VND');
  });

  it('ofTrusted throw khi giá trị sai (lỗi lập trình)', () => {
    expect(() => Money.ofTrusted(-5)).toThrow(/MONEY_NEGATIVE/);
  });
});
