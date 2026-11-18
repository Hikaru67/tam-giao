import { createHmac, timingSafeEqual } from 'node:crypto';
import { fail, ok, type Result } from '@tamgiao/kernel';
import type {
  AccessTokenClaims,
  AccessTokenError,
  AccessTokenService,
} from '../application/ports/token-services.js';

const ISSUER = 'tamgiao';
const AUDIENCE = 'user';
/** Header cố định: token có header khác (vd `alg: none`, RS256) bị từ chối ngay → không có lỗ hổng nhầm thuật toán. */
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

interface JwtPayload {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly sid: string;
  readonly iat: number;
  readonly exp: number;
}

const isPayload = (v: unknown): v is JwtPayload => {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    p.iss === ISSUER &&
    p.aud === AUDIENCE &&
    typeof p.sub === 'string' &&
    typeof p.sid === 'string' &&
    typeof p.iat === 'number' &&
    typeof p.exp === 'number'
  );
};

/** JWT HS256 tối giản (RFC 7519). Hạn dùng so với thời điểm caller truyền vào để test bằng `FakeClock`. */
export class Hs256AccessTokenService implements AccessTokenService {
  constructor(private readonly key: Buffer) {
    if (key.length < 32) throw new Error('Khoá ký access token phải dài tối thiểu 32 bytes');
  }

  issue(claims: AccessTokenClaims, now: Date, ttlSeconds: number): string {
    const iat = Math.floor(now.getTime() / 1_000);
    const payload: JwtPayload = {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: claims.userId,
      sid: claims.sessionId,
      iat,
      exp: iat + ttlSeconds,
    };
    const body = `${HEADER}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    return `${body}.${this.sign(body).toString('base64url')}`;
  }

  verify(token: string, now: Date): Result<AccessTokenClaims, AccessTokenError> {
    const parts = token.split('.');
    const [header, payloadPart, signaturePart] = parts;
    if (parts.length !== 3 || header !== HEADER || !payloadPart || !signaturePart) {
      return fail('UNAUTHENTICATED');
    }
    const expected = this.sign(`${header}.${payloadPart}`);
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return fail('UNAUTHENTICATED');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch {
      return fail('UNAUTHENTICATED');
    }
    if (!isPayload(payload)) return fail('UNAUTHENTICATED');
    if (now.getTime() >= payload.exp * 1_000) return fail('TOKEN_EXPIRED');
    return ok({ userId: payload.sub, sessionId: payload.sid });
  }

  private sign(data: string): Buffer {
    return createHmac('sha256', this.key).update(data, 'utf8').digest();
  }
}
