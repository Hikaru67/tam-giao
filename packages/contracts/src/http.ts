import { z } from 'zod';

/** Lỗi API theo RFC 7807 (Problem Details), mở rộng thêm `code` và `traceId`. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string(),
  detail: z.string().optional(),
  traceId: z.string(),
  /** Chi tiết từng trường khi `code = VALIDATION_FAILED`. */
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** `DomainError.details` (không nhạy cảm), vd `{ retryAfterSeconds: 60 }`. */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

/** Query phân trang theo cursor (không dùng offset để ổn định khi dữ liệu mới chen vào). */
export const cursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export const cursorPage = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
export type CursorPage<T> = { items: T[]; nextCursor: string | null };
