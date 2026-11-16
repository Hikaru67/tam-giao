import { describe, expect, it } from 'vitest';
import { domainError, fail } from '../domain-error.js';

describe('DomainError', () => {
  it('tạo lỗi có/không có details', () => {
    expect(domainError('OFFER_EXPIRED')).toEqual({ code: 'OFFER_EXPIRED' });
    expect(domainError('RATE_LIMITED', { retryAfterSeconds: 60 })).toEqual({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 60 },
    });
  });

  it.each(['offerExpired', 'Offer_Expired', '_X', 'X__Y', 'X-Y', ''])(
    'từ chối mã sai quy ước: %s',
    (code) => {
      expect(() => domainError(code)).toThrow(/UPPER_SNAKE_CASE/);
    },
  );

  it('fail() trả Err chứa DomainError', () => {
    const r = fail('USER_BUSY', { userId: 'u1' });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error).toEqual({ code: 'USER_BUSY', details: { userId: 'u1' } });
  });
});
