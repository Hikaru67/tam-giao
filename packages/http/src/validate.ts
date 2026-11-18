import { domainError, err, ok, type Result } from '@tamgiao/kernel';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from './context.js';
import { problemResponse } from './problem.js';

function validate<S extends z.ZodType>(
  c: Context<AppEnv>,
  schema: S,
  raw: unknown,
): Result<z.output<S>, Response> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return ok(parsed.data);
  // Chỉ trả đường dẫn + thông báo của Zod, không bao giờ trả lại giá trị người dùng gửi (có thể là PII).
  const errors = parsed.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  return err(problemResponse(c, domainError('VALIDATION_FAILED'), { errors }));
}

/** Parse body JSON theo schema. `Err` chứa sẵn response 422 `VALIDATION_FAILED` để controller trả luôn. */
export async function parseBody<S extends z.ZodType>(
  c: Context<AppEnv>,
  schema: S,
): Promise<Result<z.output<S>, Response>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return err(problemResponse(c, domainError('VALIDATION_FAILED'), { detail: 'Body phải là JSON hợp lệ' }));
  }
  return validate(c, schema, raw);
}

export function parseQuery<S extends z.ZodType>(
  c: Context<AppEnv>,
  schema: S,
): Result<z.output<S>, Response> {
  return validate(c, schema, c.req.query());
}
