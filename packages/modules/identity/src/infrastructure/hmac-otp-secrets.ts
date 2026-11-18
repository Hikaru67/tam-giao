import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { OtpSecrets } from '../application/ports/otp-secrets.js';
import { OTP_LENGTH } from '../domain/otp-policy.js';

/**
 * OTP chỉ có 10^6 khả năng nên hash thường dò ngược được ngay; dùng HMAC-SHA256 với khoá bí mật của server
 * (pepper) để hash trong DB vô dụng nếu chỉ lộ DB.
 */
export class HmacOtpSecrets implements OtpSecrets {
  constructor(private readonly pepper: Buffer) {
    if (pepper.length < 32) throw new Error('OTP pepper phải dài tối thiểu 32 bytes');
  }

  generate(): string {
    return randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');
  }

  hash(code: string, salt: string): string {
    return this.digest(code, salt).toString('base64url');
  }

  matches(code: string, salt: string, hash: string): boolean {
    const expected = Buffer.from(hash, 'base64url');
    const actual = this.digest(code, salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private digest(code: string, salt: string): Buffer {
    return createHmac('sha256', this.pepper).update(`${salt}:${code}`, 'utf8').digest();
  }
}
