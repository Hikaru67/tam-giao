import { newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import type { VoucherId } from '../domain/voucher.js';
import { VOUCHER_QR_TOKEN_TTL_SECONDS } from '../domain/voucher-qr.js';
import { derivePartnerKey, HmacPartnerTokenService } from '../infrastructure/partner-crypto.js';
import { deriveVoucherQrKey, HmacVoucherQrTokenService } from '../infrastructure/voucher-qr-token.js';

const SECRET = Buffer.alloc(32, 7);
const T0 = new Date('2026-11-18T01:00:00.000Z');
const plus = (seconds: number) => new Date(T0.getTime() + seconds * 1_000);
const service = new HmacVoucherQrTokenService(deriveVoucherQrKey(SECRET));
const VOUCHER = newId<'Voucher'>() as VoucherId;

const code = (r: { isErr(): boolean; error?: unknown }): unknown =>
  r.isErr() ? (r.error as { code: string }).code : 'OK';

describe('HmacVoucherQrTokenService (AC2)', () => {
  it('TTL nằm trong khoảng 60–120s của task', () => {
    expect(VOUCHER_QR_TOKEN_TTL_SECONDS).toBeGreaterThanOrEqual(60);
    expect(VOUCHER_QR_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(120);
  });

  it('ký rồi verify trong hạn → trả voucherId; expiresAt = now + TTL', () => {
    const issued = service.issue(VOUCHER, T0, VOUCHER_QR_TOKEN_TTL_SECONDS);
    expect(issued.expiresAt).toEqual(plus(VOUCHER_QR_TOKEN_TTL_SECONDS));
    expect(issued.token.startsWith('vq1.')).toBe(true);
    const verified = service.verify(issued.token, plus(VOUCHER_QR_TOKEN_TTL_SECONDS - 1));
    expect(verified.isOk() && verified.value).toBe(VOUCHER);
  });

  it('payload chỉ chứa id voucher + exp (không PII)', () => {
    const { token } = service.issue(VOUCHER, T0, 90);
    const payload: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    expect(payload).toEqual({ vid: VOUCHER, exp: Math.floor(T0.getTime() / 1_000) + 90 });
  });

  it('hết hạn (đúng lúc exp và sau đó) → VOUCHER_TOKEN_INVALID', () => {
    const { token } = service.issue(VOUCHER, T0, 90);
    expect(code(service.verify(token, plus(90)))).toBe('VOUCHER_TOKEN_INVALID');
    expect(code(service.verify(token, plus(3_600)))).toBe('VOUCHER_TOKEN_INVALID');
  });

  it('sửa payload (đổi voucherId / kéo dài exp) → VOUCHER_TOKEN_INVALID', () => {
    const { token } = service.issue(VOUCHER, T0, 90);
    const [prefix, , sig] = token.split('.');
    for (const forged of [
      { vid: newId<'Voucher'>(), exp: Math.floor(T0.getTime() / 1_000) + 90 },
      { vid: VOUCHER, exp: Math.floor(T0.getTime() / 1_000) + 86_400 },
    ]) {
      const body = Buffer.from(JSON.stringify(forged)).toString('base64url');
      expect(code(service.verify(`${prefix}.${body}.${sig}`, T0))).toBe('VOUCHER_TOKEN_INVALID');
    }
  });

  it('sửa chữ ký / sai định dạng / sai tiền tố → VOUCHER_TOKEN_INVALID', () => {
    const { token } = service.issue(VOUCHER, T0, 90);
    const [prefix, payload, sig = ''] = token.split('.');
    const flipped = `${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
    for (const bad of [
      `${prefix}.${payload}.${flipped}`,
      `${prefix}.${payload}`,
      `pt1.${payload}.${sig}`,
      '',
      'not-a-token',
      `${token}.extra`,
    ]) {
      expect(code(service.verify(bad, T0))).toBe('VOUCHER_TOKEN_INVALID');
    }
  });

  it('khoá khác (bí mật khác) → VOUCHER_TOKEN_INVALID', () => {
    const other = new HmacVoucherQrTokenService(deriveVoucherQrKey(Buffer.alloc(32, 8)));
    const { token } = other.issue(VOUCHER, T0, 90);
    expect(code(service.verify(token, T0))).toBe('VOUCHER_TOKEN_INVALID');
  });

  it('khoá QR tách miền với khoá token partner (cùng AUTH_SECRET)', () => {
    expect(deriveVoucherQrKey(SECRET).equals(derivePartnerKey(SECRET, 'token'))).toBe(false);
    const partnerToken = new HmacPartnerTokenService(derivePartnerKey(SECRET, 'token')).issue(
      { staffId: newId(), partnerId: newId(), tokenVersion: 1 },
      T0,
      3_600,
    ).token;
    expect(code(service.verify(partnerToken, T0))).toBe('VOUCHER_TOKEN_INVALID');
  });

  it('payload ký hợp lệ nhưng vid không phải UUID v7 → VOUCHER_TOKEN_INVALID', () => {
    const { token } = service.issue('not-a-uuid' as VoucherId, T0, 90);
    expect(code(service.verify(token, T0))).toBe('VOUCHER_TOKEN_INVALID');
  });

  it('bí mật / khoá ngắn hơn 32 bytes → throw', () => {
    expect(() => deriveVoucherQrKey(Buffer.alloc(16))).toThrow();
    expect(() => new HmacVoucherQrTokenService(Buffer.alloc(16))).toThrow();
  });
});
