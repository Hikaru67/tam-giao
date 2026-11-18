import { createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { fail, ok, type DomainError, type Result } from '@tamgiao/kernel';
import type { PartnerPinHasher } from '../application/ports/partner-pin-hasher.js';
import type {
  IssuedPartnerToken,
  PartnerTokenClaims,
  PartnerTokenService,
} from '../application/ports/partner-token-service.js';

/**
 * Dẫn xuất khoá con 32 bytes cho từng mục đích của partner từ bí mật gốc (`AUTH_SECRET`, HKDF-SHA256) — tách miền
 * với khoá của identity (`tamgiao:identity:*`), lộ một khoá con không lộ khoá khác.
 */
export function derivePartnerKey(secret: Buffer, purpose: 'token' | 'pin-pepper'): Buffer {
  if (secret.length < 32) throw new Error('Bí mật gốc phải dài tối thiểu 32 bytes');
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `tamgiao:billing:partner-${purpose}`, 32));
}

const TOKEN_PREFIX = 'pt1';

interface TokenPayload {
  readonly sid: string;
  readonly pid: string;
  readonly ver: number;
  readonly exp: number;
}

const isPayload = (v: unknown): v is TokenPayload => {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.sid === 'string' &&
    typeof p.pid === 'string' &&
    typeof p.ver === 'number' &&
    Number.isInteger(p.ver) &&
    typeof p.exp === 'number'
  );
};

/**
 * Token partner `pt1.<payload base64url>.<HMAC-SHA256 base64url>` chứa staffId, partnerId, tokenVersion, exp (giây).
 * Không chứa PII. Tiền tố cố định để không lẫn với JWT của người dùng app.
 */
export class HmacPartnerTokenService implements PartnerTokenService {
  constructor(private readonly key: Buffer) {
    if (key.length < 32) throw new Error('Khoá ký token partner phải dài tối thiểu 32 bytes');
  }

  issue(claims: PartnerTokenClaims, now: Date, ttlSeconds: number): IssuedPartnerToken {
    const exp = Math.floor(now.getTime() / 1_000) + ttlSeconds;
    const payload: TokenPayload = {
      sid: claims.staffId,
      pid: claims.partnerId,
      ver: claims.tokenVersion,
      exp,
    };
    const body = `${TOKEN_PREFIX}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    return { token: `${body}.${this.sign(body).toString('base64url')}`, expiresAt: new Date(exp * 1_000) };
  }

  verify(token: string, now: Date): Result<PartnerTokenClaims, DomainError<'PARTNER_TOKEN_INVALID'>> {
    const parts = token.split('.');
    const [prefix, payloadPart, signaturePart] = parts;
    if (parts.length !== 3 || prefix !== TOKEN_PREFIX || !payloadPart || !signaturePart) {
      return fail('PARTNER_TOKEN_INVALID');
    }
    const expected = this.sign(`${prefix}.${payloadPart}`);
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return fail('PARTNER_TOKEN_INVALID');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch {
      return fail('PARTNER_TOKEN_INVALID');
    }
    if (!isPayload(payload)) return fail('PARTNER_TOKEN_INVALID');
    if (now.getTime() >= payload.exp * 1_000) return fail('PARTNER_TOKEN_INVALID');
    return ok({ staffId: payload.sid, partnerId: payload.pid, tokenVersion: payload.ver });
  }

  private sign(data: string): Buffer {
    return createHmac('sha256', this.key).update(data, 'utf8').digest();
  }
}

/**
 * Tham số scrypt: N = 2^15, r = 8, p = 1 (~32 MiB). Thấp hơn mức OWASP cho mật khẩu (N = 2^17) để đăng nhập ở quán
 * nhanh; bù lại PIN có pepper (HMAC với khoá bí mật ngoài DB) nên lộ DB mà không lộ khoá thì không dò offline được.
 */
const SCRYPT = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const HASH_PREFIX = 'scrypt';

const scryptAsync = (password: Buffer, salt: Buffer, options: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

/**
 * Băm PIN: `scrypt(HMAC-SHA256(pepper, pin), salt ngẫu nhiên)`, lưu dạng `scrypt$N$r$p$<salt>$<hash>` (base64url).
 * PIN 6 số có không gian nhỏ → pepper (không nằm trong DB) + khoá tạm sau 5 lần sai mới là lớp bảo vệ chính.
 */
export class ScryptPartnerPinHasher implements PartnerPinHasher {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly pepper: Buffer,
    private readonly options: { readonly N: number; readonly r: number; readonly p: number } = SCRYPT,
  ) {
    if (pepper.length < 32) throw new Error('Pepper PIN phải dài tối thiểu 32 bytes');
  }

  async hash(pin: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const { N, r, p } = this.options;
    const key = await scryptAsync(this.peppered(pin), salt, { N, r, p, maxmem: SCRYPT.maxmem });
    return [HASH_PREFIX, N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
  }

  async verify(storedHash: string | null, pin: string): Promise<boolean> {
    if (storedHash === null) {
      this.dummyHash ??= this.hash('000000');
      await this.compare(await this.dummyHash, pin);
      return false;
    }
    return this.compare(storedHash, pin);
  }

  private async compare(storedHash: string, pin: string): Promise<boolean> {
    const [prefix, n, r, p, saltPart, keyPart] = storedHash.split('$');
    if (prefix !== HASH_PREFIX || !n || !r || !p || !saltPart || !keyPart) return false;
    const expected = Buffer.from(keyPart, 'base64url');
    try {
      const actual = await scryptAsync(this.peppered(pin), Buffer.from(saltPart, 'base64url'), {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: SCRYPT.maxmem,
      });
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      // Chuỗi hash hỏng (tham số sai) → coi như sai PIN, không làm sập request.
      return false;
    }
  }

  private peppered(pin: string): Buffer {
    return createHmac('sha256', this.pepper).update(pin, 'utf8').digest();
  }
}
