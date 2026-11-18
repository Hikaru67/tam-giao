import { domainError, type DomainError, type Result } from '@tamgiao/kernel';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, UserAuth } from './context.js';
import { problemResponse } from './problem.js';

/** Hàm kiểm tra access token — do module identity cung cấp qua facade (`authenticateUser`). */
export type UserAuthenticator = (accessToken: string) => Promise<Result<UserAuth, DomainError>>;

/** Lấy token từ header `Authorization: Bearer <token>`; sai dạng → undefined. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header ?? '');
  return match?.[1];
}

/**
 * Bắt buộc request có access token hợp lệ của người dùng app; gắn `c.get('auth')` (`userId`, `sessionId`).
 * Thiếu/sai token → 401 `UNAUTHENTICATED`; hết hạn → 401 `TOKEN_EXPIRED` (client gọi `/auth/refresh`).
 */
export const requireUser = (authenticate: UserAuthenticator) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return problemResponse(c, domainError('UNAUTHENTICATED'));
    const auth = await authenticate(token);
    if (auth.isErr()) return problemResponse(c, auth.error);
    c.set('auth', auth.value);
    return next();
  });
