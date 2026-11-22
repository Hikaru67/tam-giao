import { describe, expect, it } from 'vitest';
import { OTP_LENGTH, sanitizeOtp } from './otp.js';

describe('otp core', () => {
  it('hằng số OTP_LENGTH là 6', () => {
    expect(OTP_LENGTH).toBe(6);
  });

  it('sanitizeOtp lọc bỏ ký tự không phải số và cắt tối đa 6 ký tự', () => {
    expect(sanitizeOtp('123456')).toBe('123456');
    expect(sanitizeOtp('12a3b4c5d6e7')).toBe('123456');
    expect(sanitizeOtp('  84 29 -- ')).toBe('8429');
    expect(sanitizeOtp('9876543210')).toBe('987654');
    expect(sanitizeOtp('')).toBe('');
  });
});
