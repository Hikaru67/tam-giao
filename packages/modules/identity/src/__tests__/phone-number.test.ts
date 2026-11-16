import { describe, expect, it } from 'vitest';
import { PhoneNumber } from '../domain/phone-number.js';

describe('PhoneNumber', () => {
  it.each([
    ['0912345678', '+84912345678'],
    ['0912 345 678', '+84912345678'],
    ['091.234.5678', '+84912345678'],
    ['84912345678', '+84912345678'],
    ['+84912345678', '+84912345678'],
    ['+84 (0) 912-345-678', '+84912345678'],
    ['0351234567', '+84351234567'],
    ['0781234567', '+84781234567'],
  ])('chuẩn hoá %s → %s', (raw, e164) => {
    const phone = PhoneNumber.parse(raw);
    expect(phone.isOk() && phone.value.e164).toBe(e164);
  });

  it.each([
    '',
    '912345678', // thiếu số 0 / mã quốc gia
    '0212345678', // đầu số cố định
    '091234567', // thiếu 1 số
    '09123456789', // thừa 1 số
    '+1 202 555 0143', // không phải Việt Nam
    '0912abc678',
    '８４９１２３４５６７８', // chữ số full-width
  ])('từ chối %j → PHONE_INVALID', (raw) => {
    const phone = PhoneNumber.parse(raw);
    expect(phone.isErr() && phone.error.code).toBe('PHONE_INVALID');
  });

  it('so sánh theo giá trị và che số khi hiển thị', () => {
    const a = PhoneNumber.parse('0912345678').unwrapOr(null as never);
    const b = PhoneNumber.parse('+84912345678').unwrapOr(null as never);
    expect(a.equals(b)).toBe(true);
    expect(a.masked()).toBe('+84•••••5678');
    expect(a.masked()).not.toContain('91234');
  });
});
