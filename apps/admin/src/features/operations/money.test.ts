import { describe, it, expect } from 'vitest';
import { formatVndBigInt, formatReportDateString } from './money';

describe('formatVndBigInt', () => {
  it('định dạng số 0 chính xác', () => {
    expect(formatVndBigInt('0')).toBe('0 ₫');
  });

  it('định dạng số tiền dương chính xác', () => {
    expect(formatVndBigInt('299000')).toBe('299.000 ₫');
  });

  it('định dạng số tiền âm chính xác', () => {
    expect(formatVndBigInt('-500000')).toBe('-500.000 ₫');
  });

  it('định dạng số tiền lớn vượt Number.MAX_SAFE_INTEGER mà không mất độ chính xác', () => {
    // Number('9007199254740993') sẽ bị làm tròn thành 9007199254740992
    const result = formatVndBigInt('9007199254740993');
    expect(result).toContain('9.007.199.254.740.993');
    expect(result).not.toContain('9.007.199.254.740.992');
  });

  it('chuỗi không phải số nguyên thì trả nguyên chuỗi', () => {
    expect(formatVndBigInt('invalid')).toBe('invalid');
    expect(formatVndBigInt('12.34')).toBe('12.34');
    expect(formatVndBigInt('')).toBe('');
    expect(formatVndBigInt('100k')).toBe('100k');
  });
});

describe('formatReportDateString', () => {
  it('cắt chuỗi YYYY-MM-DD thành DD/MM/YYYY không qua Date', () => {
    expect(formatReportDateString('2026-11-24')).toBe('24/11/2026');
    expect(formatReportDateString('2025-01-05')).toBe('05/01/2025');
  });

  it('chuỗi không đúng định dạng thì trả nguyên', () => {
    expect(formatReportDateString('invalid-date')).toBe('invalid-date');
  });
});
