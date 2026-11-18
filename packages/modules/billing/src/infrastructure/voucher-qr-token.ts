import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { fail, ok, parseId, type DomainError, type Result } from '@tamgiao/kernel';
import type {
  IssuedVoucherQrToken,
  VoucherQrTokenService,
} from '../application/ports/voucher-qr-token-service.js';
import type { VoucherId } from '../domain/voucher.js';

/**
 * Dẫn xuất khoá ký QR voucher 32 bytes từ bí mật gốc (`AUTH_SECRET`, HKDF-SHA256) — tách miền với khoá partner
 * (`tamgiao:billing:partner-*`) và identity, nên token partner không thể dùng làm token QR và ngược lại.
 */
export function deriveVoucherQrKey(secret: Buffer): Buffer {
  if (secret.length < 32) throw new Error('Bí mật gốc phải dài tối thiểu 32 bytes');
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'tamgiao:billing:voucher-qr', 32));
}

const TOKEN_PREFIX = 'vq1';

interface TokenPayload {
  readonly vid: string;
  readonly exp: number;
}

const isPayload = (v: unknown): v is TokenPayload => {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.vid === 'string' && typeof p.exp === 'number' && Number.isInteger(p.exp);
};

const invalid = (): Result<never, DomainError<'VOUCHER_TOKEN_INVALID'>> => fail('VOUCHER_TOKEN_INVALID');

/**
 * Token QR voucher `vq1.<payload base64url>.<HMAC-SHA256 base64url>`, payload `{ vid, exp }` (exp tính bằng giây).
 * Không chứa PII (chỉ id voucher). So chữ ký bằng `timingSafeEqual`.
 */
export class HmacVoucherQrTokenService implements VoucherQrTokenService {
  constructor(private readonly key: Buffer) {
    if (key.length < 32) throw new Error('Khoá ký QR voucher phải dài tối thiểu 32 bytes');
  }

  issue(voucherId: VoucherId, now: Date, ttlSeconds: number): IssuedVoucherQrToken {
    const exp = Math.floor(now.getTime() / 1_000) + ttlSeconds;
    const payload: TokenPayload = { vid: voucherId, exp };
    const body = `${TOKEN_PREFIX}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    return { token: `${body}.${this.sign(body).toString('base64url')}`, expiresAt: new Date(exp * 1_000) };
  }

  verify(token: string, now: Date): Result<VoucherId, DomainError<'VOUCHER_TOKEN_INVALID'>> {
    const parts = token.split('.');
    const [prefix, payloadPart, signaturePart] = parts;
    if (parts.length !== 3 || prefix !== TOKEN_PREFIX || !payloadPart || !signaturePart) return invalid();
    const expected = this.sign(`${prefix}.${payloadPart}`);
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return invalid();
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch {
      return invalid();
    }
    if (!isPayload(payload)) return invalid();
    if (now.getTime() >= payload.exp * 1_000) return invalid();
    const id = parseId<'Voucher'>(payload.vid);
    return id.isOk() ? ok(id.value) : invalid();
  }

  private sign(data: string): Buffer {
    return createHmac('sha256', this.key).update(data, 'utf8').digest();
  }
}
