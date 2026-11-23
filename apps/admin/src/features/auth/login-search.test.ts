import { describe, expect, it } from 'vitest';
import { parseLoginSearch, safeRedirectTarget } from './login-search';

describe('parseLoginSearch', () => {
  it('giữ đường dẫn nội bộ', () => {
    expect(parseLoginSearch({ redirect: '/kyc?tab=pending' })).toEqual({ redirect: '/kyc?tab=pending' });
  });

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'kyc', ''])(
    'bỏ redirect không an toàn: %s',
    (redirect) => {
      expect(parseLoginSearch({ redirect })).toEqual({});
    },
  );

  it('bỏ giá trị không phải chuỗi', () => {
    expect(parseLoginSearch({ redirect: 42 })).toEqual({});
    expect(parseLoginSearch({})).toEqual({});
  });
});

describe('safeRedirectTarget', () => {
  it('về trang tổng quan khi redirect không an toàn hoặc thiếu', () => {
    expect(safeRedirectTarget({ redirect: '//evil.com' })).toBe('/');
    expect(safeRedirectTarget({})).toBe('/');
    expect(safeRedirectTarget({ redirect: '/audit' })).toBe('/audit');
  });
});
