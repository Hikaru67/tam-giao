import { domainError } from '@tamgiao/kernel';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './context.js';
import { problemResponse } from './problem.js';

const STATUS_TO_CODE: Readonly<Record<number, string>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

/**
 * Lỗi không bắt được trong handler: log đầy đủ (kèm stack) ở server, trả Problem JSON không lộ stack.
 * `HTTPException` (vd body quá lớn) được map sang mã lỗi tương ứng.
 */
export function handleError(error: Error, c: Context<AppEnv>): Response {
  if (error instanceof HTTPException && error.status < 500) {
    return problemResponse(c, domainError(STATUS_TO_CODE[error.status] ?? 'VALIDATION_FAILED'));
  }
  c.get('logger').error({ err: error }, 'unhandled error');
  return problemResponse(c, domainError('INTERNAL_ERROR'));
}

export function handleNotFound(c: Context<AppEnv>): Response {
  return problemResponse(c, domainError('NOT_FOUND'));
}
