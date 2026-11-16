import { describe, expect, it } from 'vitest';
import { COMMON_ERROR_CODES, ErrorRegistry, errorRegistry } from '../errors.js';

describe('ErrorRegistry', () => {
  it('đăng ký và tra cứu mã lỗi', () => {
    const registry = new ErrorRegistry();
    const codes = registry.register('matching', {
      USER_BUSY: { status: 409, title: 'Người dùng đang trong một kết nối khác' },
      OFFER_EXPIRED: { status: 410, title: 'Gợi ý đã hết hạn' },
    });
    expect(codes).toEqual(['USER_BUSY', 'OFFER_EXPIRED']);
    expect(registry.get('USER_BUSY')).toEqual({
      code: 'USER_BUSY',
      owner: 'matching',
      status: 409,
      title: 'Người dùng đang trong một kết nối khác',
    });
    expect(registry.statusOf('OFFER_EXPIRED')).toBe(410);
    expect(registry.list()).toHaveLength(2);
  });

  it('đăng ký trùng mã lỗi → throw, không ghi đè (AC2)', () => {
    const registry = new ErrorRegistry();
    registry.register('matching', { USER_BUSY: { status: 409, title: 'a' } });
    expect(() => registry.register('dating', { USER_BUSY: { status: 400, title: 'b' } })).toThrow(
      /đã được "matching" đăng ký/,
    );
    expect(registry.get('USER_BUSY')?.owner).toBe('matching');
  });

  it('trùng trong một lần đăng ký nhiều mã → không đăng ký phần nào (nguyên tử)', () => {
    const registry = new ErrorRegistry();
    registry.register('a', { X_ONE: { status: 400, title: 'x' } });
    expect(() =>
      registry.register('b', { Y_TWO: { status: 400, title: 'y' }, X_ONE: { status: 400, title: 'x' } }),
    ).toThrow();
    expect(registry.get('Y_TWO')).toBeUndefined();
  });

  it('mã sai quy ước → throw', () => {
    expect(() => new ErrorRegistry().register('x', { userBusy: { status: 409, title: 't' } })).toThrow(
      /UPPER_SNAKE_CASE/,
    );
  });

  it('mã chưa đăng ký → status 500', () => {
    expect(new ErrorRegistry().statusOf('UNKNOWN_CODE')).toBe(500);
  });

  it('registry toàn cục có sẵn mã lỗi chung, kể cả lỗi của kernel', () => {
    expect(COMMON_ERROR_CODES).toEqual(
      expect.arrayContaining(['VALIDATION_FAILED', 'UNAUTHENTICATED', 'INVALID_ID', 'MONEY_NEGATIVE']),
    );
    expect(errorRegistry.statusOf('UNAUTHENTICATED')).toBe(401);
    expect(errorRegistry.statusOf('RATE_LIMITED')).toBe(429);
  });
});
