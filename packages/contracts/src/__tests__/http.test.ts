import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, cursorPage, cursorQuerySchema, problemSchema } from '../http.js';

describe('http contracts', () => {
  it('problemSchema chấp nhận Problem JSON hợp lệ và từ chối status ngoài 4xx/5xx', () => {
    const problem = {
      type: 'about:blank',
      title: 'Gợi ý đã hết hạn',
      status: 410,
      code: 'OFFER_EXPIRED',
      traceId: 'abc',
    };
    expect(problemSchema.parse(problem)).toEqual(problem);
    expect(problemSchema.safeParse({ ...problem, status: 200 }).success).toBe(false);
  });

  it('cursorQuerySchema: mặc định limit, ép kiểu từ query string, chặn quá giới hạn', () => {
    expect(cursorQuerySchema.parse({})).toEqual({ limit: PAGE_LIMIT_DEFAULT });
    expect(cursorQuerySchema.parse({ limit: '50', cursor: 'c1' })).toEqual({ limit: 50, cursor: 'c1' });
    expect(cursorQuerySchema.safeParse({ limit: String(PAGE_LIMIT_MAX + 1) }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('cursorPage bọc danh sách item', () => {
    const page = cursorPage(z.object({ id: z.string() }));
    expect(page.parse({ items: [{ id: '1' }], nextCursor: null })).toEqual({
      items: [{ id: '1' }],
      nextCursor: null,
    });
    expect(page.safeParse({ items: [{ id: 1 }], nextCursor: null }).success).toBe(false);
  });
});
