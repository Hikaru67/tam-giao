import { hkdfSync } from 'node:crypto';

/** Dẫn xuất khoá con 32 bytes cho từng mục đích từ `AUTH_SECRET` (HKDF-SHA256) — lộ một khoá con không lộ khoá khác. */
export function deriveKey(secret: Buffer, purpose: string): Buffer {
  if (secret.length < 32) throw new Error('AUTH_SECRET phải dài tối thiểu 32 bytes');
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `tamgiao:identity:${purpose}`, 32));
}
