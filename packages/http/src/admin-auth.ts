import { domainError, type DomainError, type Result } from '@tamgiao/kernel';
import { createMiddleware } from 'hono/factory';
import { bearerToken } from './auth.js';
import type { AdminAuth, AppEnv } from './context.js';
import { problemResponse } from './problem.js';

/** Hàm kiểm tra token phiên admin — do module identity cung cấp qua facade (`authenticateAdmin`). */
export type AdminAuthenticator = (token: string) => Promise<Result<AdminAuth, DomainError>>;

/**
 * Tạo guard cho route admin: `requireAdmin('kyc:review')`. Thiếu/sai/hết hạn token → 401 `UNAUTHENTICATED`;
 * role không có permission → 403 `FORBIDDEN`. Gọi không tham số = chỉ cần đăng nhập (vd `/admin/auth/me`).
 * Gắn `c.get('admin')`.
 */
export const createRequireAdmin = (authenticate: AdminAuthenticator) => (permission?: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return problemResponse(c, domainError('UNAUTHENTICATED'));
    const admin = await authenticate(token);
    if (admin.isErr()) return problemResponse(c, admin.error);
    if (permission !== undefined && !admin.value.permissions.includes(permission)) {
      return problemResponse(c, domainError('FORBIDDEN', { permission }));
    }
    c.set('admin', admin.value);
    return next();
  });

export type RequireAdmin = ReturnType<typeof createRequireAdmin>;
