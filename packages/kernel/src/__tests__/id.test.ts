import { describe, expect, it } from 'vitest';
import { newId, parseId } from '../id.js';

describe('Id', () => {
  it('newId sinh UUID v7 tăng dần theo thời gian', () => {
    const a = newId<'User'>();
    const b = newId<'User'>();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it('parseId chấp nhận UUID v7 và chuẩn hoá chữ thường', () => {
    const raw = newId<'Match'>().toUpperCase();
    const r = parseId<'Match'>(raw);
    expect(r.isOk() && r.value).toBe(raw.toLowerCase());
  });

  it.each(['', 'abc', '550e8400-e29b-41d4-a716-446655440000' /* v4 */])('parseId từ chối: "%s"', (raw) => {
    const r = parseId(raw);
    expect(r.isErr() && r.error.code).toBe('INVALID_ID');
  });
});
