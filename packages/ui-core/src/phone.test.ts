import { describe, expect, it } from 'vitest';
import { formatVnPhoneDisplay, normalizeVnPhone } from './phone.js';

describe('phone core', () => {
  describe('normalizeVnPhone', () => {
    const validCases: readonly (readonly [string, string])[] = [
      ['0912345678', '+84912345678'],
      ['912345678', '+84912345678'],
      ['+84912345678', '+84912345678'],
      ['84912345678', '+84912345678'],
      ['0912 345 678', '+84912345678'],
      ['0912.345.678', '+84912345678'],
      ['(0912) 345-678', '+84912345678'],
      ['0323456789', '+84323456789'],
      ['0523456789', '+84523456789'],
      ['0723456789', '+84723456789'],
      ['0823456789', '+84823456789'],
    ];

    for (const [input, expected] of validCases) {
      it(`chuẩn hoá thành công số hợp lệ: ${input} -> ${expected}`, () => {
        expect(normalizeVnPhone(input)).toBe(expected);
      });
    }

    const invalidCases = [
      '',
      '   ',
      'abc',
      '0123456789', // đầu 1 không phải di động VN
      '0243456789', // đầu 2 là cố định
      '091234567', // thiếu chữ số
      '09123456789', // thừa chữ số
      '+840912345678', // thừa số 0 sau +84
      '+1234567890',
    ];

    for (const input of invalidCases) {
      it(`trả về null cho số không hợp lệ: "${input}"`, () => {
        expect(normalizeVnPhone(input)).toBeNull();
      });
    }
  });

  describe('formatVnPhoneDisplay', () => {
    it('định dạng số hiển thị 0XXX XXX XXX', () => {
      expect(formatVnPhoneDisplay('+84912345678')).toBe('0912 345 678');
      expect(formatVnPhoneDisplay('0912345678')).toBe('0912 345 678');
      expect(formatVnPhoneDisplay('invalid')).toBe('invalid');
    });
  });
});
