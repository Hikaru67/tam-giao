import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DataExportLinkSigner } from '../application/ports/data-rights.js';

/** Ký liên kết tải file xuất dữ liệu bằng HMAC-SHA256 (khoá dẫn xuất từ `AUTH_SECRET`, miền riêng). */
export class HmacDataExportLinkSigner implements DataExportLinkSigner {
  constructor(private readonly key: Buffer) {
    if (key.length < 32) throw new Error('Khoá ký liên kết xuất dữ liệu phải dài tối thiểu 32 bytes');
  }

  sign(exportId: string, expiresAtEpochSeconds: number): string {
    return this.digest(exportId, expiresAtEpochSeconds).toString('base64url');
  }

  verify(exportId: string, expiresAtEpochSeconds: number, signature: string): boolean {
    const expected = this.digest(exportId, expiresAtEpochSeconds);
    const actual = Buffer.from(signature, 'base64url');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private digest(exportId: string, expires: number): Buffer {
    return createHmac('sha256', this.key).update(`data-export:${exportId}:${expires}`, 'utf8').digest();
  }
}
