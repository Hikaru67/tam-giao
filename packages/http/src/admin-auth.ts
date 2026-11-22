import { domainError, type DomainError, type Result } from '@tamgiao/kernel';
import { createMiddleware } from 'hono/factory';
import { bearerToken } from './auth.js';
import type { AdminAuth, AppEnv } from './context.js';
import { problemResponse } from './problem.js';

/** Hàm kiểm tra token phiên admin — do module identity cung cấp qua facade (`authenticateAdmin`). */
export type AdminAuthenticator = (token: string) => Promise<Result<AdminAuth, DomainError>>;

/** Dấu gắn trên middleware do `requireAdmin` tạo ra (BE-S7-07: test meta rà route admin thiếu guard). */
export interface AdminGuardMark {
  /** Permission guard yêu cầu; `undefined` = chỉ cần đăng nhập admin. */
  readonly permission: string | undefined;
}

const ADMIN_GUARDS = new WeakMap<object, AdminGuardMark>();

/** Trả dấu guard nếu `handler` là middleware do `requireAdmin(...)` tạo, ngược lại `undefined`. */
export function adminGuardMark(handler: unknown): AdminGuardMark | undefined {
  return typeof handler === 'function' ? ADMIN_GUARDS.get(handler) : undefined;
}

/**
 * Tạo guard cho route admin: `requireAdmin('kyc:review')`. Thiếu/sai/hết hạn token → 401 `UNAUTHENTICATED`;
 * role không có permission → 403 `FORBIDDEN`. Gọi không tham số = chỉ cần đăng nhập (vd `/admin/auth/me`).
 * Gắn `c.get('admin')`. Middleware trả về mang dấu `adminGuardMark` để test liệt kê route admin thiếu guard.
 */
export const createRequireAdmin = (authenticate: AdminAuthenticator) => (permission?: string) => {
  const guard = createMiddleware<AppEnv>(async (c, next) => {
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
  ADMIN_GUARDS.set(guard, { permission });
  return guard;
};

export type RequireAdmin = ReturnType<typeof createRequireAdmin>;
