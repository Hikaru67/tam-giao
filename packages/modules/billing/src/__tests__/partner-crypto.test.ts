import { addDuration } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import {
  derivePartnerKey,
  HmacPartnerTokenService,
  ScryptPartnerPinHasher,
} from '../infrastructure/partner-crypto.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const SECRET = Buffer.alloc(32, 3);
const claims = {
  staffId: '0196f1a0-0000-7000-8000-000000000001',
  partnerId: '0196f1a0-0000-7000-8000-000000000002',
  tokenVersion: 3,
};

describe('derivePartnerKey', () => {
  it('khoá theo mục đích khác nhau, ổn định; bí mật ngắn → throw', () => {
    const token = derivePartnerKey(SECRET, 'token');
    expect(token).toHaveLength(32);
    expect(token.equals(derivePartnerKey(SECRET, 'token'))).toBe(true);
    expect(token.equals(derivePartnerKey(SECRET, 'pin-pepper'))).toBe(false);
    expect(() => derivePartnerKey(Buffer.alloc(16), 'token')).toThrow();
  });
});

describe('HmacPartnerTokenService', () => {
  const service = new HmacPartnerTokenService(derivePartnerKey(SECRET, 'token'));

  it('cấp rồi kiểm tra được claims; expiresAt = now + ttl', () => {
    const issued = service.issue(claims, T0, 3_600);
    expect(issued.expiresAt).toEqual(addDuration(T0, { hours: 1 }));
    expect(issued.token.startsWith('pt1.')).toBe(true);
    const r = service.verify(issued.token, addDuration(T0, { minutes: 59 }));
    expect(r.isOk() && r.value).toEqual(claims);
  });

  it('hết hạn (đúng mốc exp) → PARTNER_TOKEN_INVALID', () => {
    const { token } = service.issue(claims, T0, 3_600);
    const r = service.verify(token, addDuration(T0, { hours: 1 }));
    expect(r.isErr() && r.error.code).toBe('PARTNER_TOKEN_INVALID');
  });

  it('sửa payload / chữ ký / tiền tố, hoặc ký bằng khoá khác → PARTNER_TOKEN_INVALID', () => {
    const { token } = service.issue(claims, T0, 3_600);
    const [prefix, payload, signature] = token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ sid: claims.staffId, pid: 'x', ver: 3, exp: 9e9 })).toString(
      'base64url',
    );
    const other = new HmacPartnerTokenService(Buffer.alloc(32, 1)).issue(claims, T0, 3_600).token;
    for (const bad of [
      `${prefix}.${forged}.${signature}`,
      `${prefix}.${payload}.${signature.slice(0, -2)}AA`,
      `jwt.${payload}.${signature}`,
      `${prefix}.${payload}`,
      other,
      '',
    ]) {
      const r = service.verify(bad, T0);
      expect(r.isErr() && r.error.code).toBe('PARTNER_TOKEN_INVALID');
    }
  });

  it('khoá ngắn → throw', () => {
    expect(() => new HmacPartnerTokenService(Buffer.alloc(16))).toThrow();
  });
});

describe('ScryptPartnerPinHasher', () => {
  // N nhỏ cho test nhanh; tham số lưu trong chuỗi hash nên verify vẫn đúng.
  const hasher = new ScryptPartnerPinHasher(derivePartnerKey(SECRET, 'pin-pepper'), { N: 1_024, r: 8, p: 1 });

  it('hash không chứa PIN gốc, salt ngẫu nhiên; verify đúng/sai', async () => {
    const a = await hasher.hash('123456');
    const b = await hasher.hash('123456');
    expect(a).not.toContain('123456');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(await hasher.verify(a, '123456')).toBe(true);
    expect(await hasher.verify(a, '654321')).toBe(false);
  });

  it('pepper khác → không khớp (lộ DB mà không có khoá thì vô dụng)', async () => {
    const other = new ScryptPartnerPinHasher(Buffer.alloc(32, 8), { N: 1_024, r: 8, p: 1 });
    expect(await other.verify(await hasher.hash('123456'), '123456')).toBe(false);
  });

  it('hash null (không có tài khoản) hoặc hỏng → false, không throw', async () => {
    expect(await hasher.verify(null, '123456')).toBe(false);
    expect(await hasher.verify('garbage', '123456')).toBe(false);
    expect(await hasher.verify('scrypt$3$8$1$AAAA$BBBB', '123456')).toBe(false);
  });
});
