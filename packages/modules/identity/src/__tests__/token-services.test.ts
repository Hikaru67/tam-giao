import { describe, expect, it } from 'vitest';
import { Hs256AccessTokenService } from '../infrastructure/hs256-access-token-service.js';
import { RandomRefreshTokenSecrets } from '../infrastructure/random-refresh-token-secrets.js';

const NOW = new Date('2026-11-16T08:00:00.000Z');
const TTL = 900;
const CLAIMS = {
  userId: '0190a1b2-0000-7000-8000-000000000001',
  sessionId: '0190a1b2-0000-7000-8000-000000000002',
};
const service = new Hs256AccessTokenService(Buffer.alloc(32, 1));
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1_000);
const codeOf = (r: { isErr(): boolean; error?: { code: string } }) => (r.isErr() ? r.error?.code : undefined);
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

describe('Hs256AccessTokenService', () => {
  const token = service.issue(CLAIMS, NOW, TTL);

  it('issue rồi verify → đúng userId/sessionId', () => {
    const r = service.verify(token, NOW);
    expect(r.isOk() && r.value).toEqual(CLAIMS);
  });

  it('ngay trước exp còn hợp lệ; tại exp → TOKEN_EXPIRED', () => {
    expect(service.verify(token, at(TTL - 1)).isOk()).toBe(true);
    expect(codeOf(service.verify(token, at(TTL)))).toBe('TOKEN_EXPIRED');
  });

  it('chữ ký sai, payload bị sửa, khoá khác → UNAUTHENTICATED', () => {
    const [header, payload, signature] = token.split('.') as [string, string, string];
    const flipped = `${signature.slice(0, -2)}${signature.endsWith('A') ? 'B' : 'A'}${signature.slice(-1)}`;
    const forgedPayload = b64({
      ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
      sub: 'attacker',
    });
    const other = new Hs256AccessTokenService(Buffer.alloc(32, 2));

    expect(codeOf(service.verify(`${header}.${payload}.${flipped}`, NOW))).toBe('UNAUTHENTICATED');
    expect(codeOf(service.verify(`${header}.${forgedPayload}.${signature}`, NOW))).toBe('UNAUTHENTICATED');
    expect(codeOf(other.verify(token, NOW))).toBe('UNAUTHENTICATED');
  });

  it('header alg none → UNAUTHENTICATED', () => {
    const payload = token.split('.')[1];
    expect(codeOf(service.verify(`${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`, NOW))).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('chuỗi rác / sai số phần → UNAUTHENTICATED', () => {
    for (const bad of ['', 'garbage', 'a.b', `${token}.extra`, 'a.b.c']) {
      expect(codeOf(service.verify(bad, NOW))).toBe('UNAUTHENTICATED');
    }
  });

  it('khoá < 32 bytes → throw', () => {
    expect(() => new Hs256AccessTokenService(Buffer.alloc(31))).toThrow();
  });
});

describe('RandomRefreshTokenSecrets', () => {
  const secrets = new RandomRefreshTokenSecrets();

  it('sinh token base64url ≥ 43 ký tự, mỗi lần khác nhau', () => {
    const a = secrets.generate();
    const b = secrets.generate();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(a).not.toBe(b);
  });

  it('hash ổn định, hex 64 ký tự, khác token gốc', () => {
    const token = secrets.generate();
    const hash = secrets.hash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.hash(token)).toBe(hash);
    expect(hash).not.toBe(token);
  });
});
