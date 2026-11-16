import { errorRegistry, type Problem } from '@tamgiao/contracts';
import type { DomainError, Result } from '@tamgiao/kernel';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './context.js';

/** Dựng Problem JSON (RFC 7807) từ mã lỗi đã đăng ký trong registry. */
export function toProblem(
  error: DomainError,
  traceId: string,
  extra: Pick<Problem, 'detail' | 'errors'> = {},
): Problem {
  const registered = errorRegistry.get(error.code);
  const problem: Problem = {
    type: `urn:tamgiao:error:${error.code}`,
    title: registered?.title ?? 'Lỗi hệ thống',
    status: errorRegistry.statusOf(error.code),
    code: error.code,
    traceId,
    ...extra,
  };
  if (error.details !== undefined) problem.meta = { ...error.details };
  return problem;
}

export function problemResponse(
  c: Context<AppEnv>,
  error: DomainError,
  extra: Pick<Problem, 'detail' | 'errors'> = {},
): Response {
  const problem = toProblem(error, c.get('traceId'), extra);
  if (!errorRegistry.get(error.code)) {
    // Quên đăng ký mã lỗi là lỗi lập trình → log để sửa, client nhận 500.
    c.get('logger').error({ code: error.code }, 'unregistered error code');
  }
  return c.json(problem, problem.status as ContentfulStatusCode, {
    'content-type': 'application/problem+json',
  });
}

/** Trả kết quả use case: `Ok` → JSON với status cho trước, `Err` → Problem JSON theo registry. */
export function sendResult<T>(
  c: Context<AppEnv>,
  result: Result<T, DomainError>,
  status: ContentfulStatusCode = 200,
): Response {
  return result.match(
    (value) => c.json(value as object, status),
    (error) => problemResponse(c, error),
  );
}
