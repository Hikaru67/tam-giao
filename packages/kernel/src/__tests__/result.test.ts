import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '../result.js';

const parsePositive = (n: number): Result<number, 'NOT_POSITIVE'> => (n > 0 ? ok(n) : err('NOT_POSITIVE'));

describe('Result', () => {
  it('ok() không tham số trả Ok<void>', () => {
    const r = ok();
    expect(r.isOk()).toBe(true);
    expect(r.isErr()).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('Ok: map, mapErr, andThen, match, unwrapOr', () => {
    const r = ok<number, 'E'>(2);
    expect(r.map((v) => v * 10).unwrapOr(0)).toBe(20);
    expect(r.mapErr(() => 'OTHER').unwrapOr(0)).toBe(2);
    expect(r.andThen(parsePositive).isOk()).toBe(true);
    expect(
      r.match(
        (v) => `ok:${v}`,
        (e) => `err:${e}`,
      ),
    ).toBe('ok:2');
    expect(r.unwrapOr(99)).toBe(2);
  });

  it('Err: map bỏ qua, mapErr đổi lỗi, andThen ngắt chuỗi, match nhánh lỗi, unwrapOr trả fallback', () => {
    const r = err<'BOOM', number>('BOOM');
    expect(r.isErr()).toBe(true);
    expect(r.isOk()).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.map((v) => v * 10).isErr()).toBe(true);
    const mapped = r.mapErr((e) => `${e}!`);
    expect(mapped.isErr() && mapped.error).toBe('BOOM!');
    let called = false;
    const chained = r.andThen((v) => {
      called = true;
      return parsePositive(v);
    });
    expect(called).toBe(false);
    expect(chained.isErr() && chained.error).toBe('BOOM');
    expect(
      r.match(
        (v) => `ok:${v}`,
        (e) => `err:${e}`,
      ),
    ).toBe('err:BOOM');
    expect(r.unwrapOr(99)).toBe(99);
  });

  it('andThen trả về lỗi của bước sau', () => {
    const r = ok<number, 'E'>(-1).andThen(parsePositive);
    expect(r.isErr() && r.error).toBe('NOT_POSITIVE');
  });
});
