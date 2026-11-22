import { adminGuardMark } from '@tamgiao/http';

/** Một bản ghi route của Hono (`app.routes`): mỗi middleware/handler gắn trên route là một bản ghi. */
export interface RouteRecord {
  readonly method: string;
  readonly path: string;
  readonly handler: unknown;
}

/** Endpoint duy nhất `"METHOD /path"` (gộp middleware + handler cùng route). */
export type RouteKey = `${string} /${string}`;

export interface AdminRouteAuditOptions {
  /** Route admin công khai (không cần phiên admin), vd `POST /admin/auth/login`. */
  readonly publicRoutes: readonly string[];
  /** Route chỉ cần đăng nhập admin, không cần permission cụ thể, vd `GET /admin/auth/me`. */
  readonly loginOnlyRoutes: readonly string[];
}

export interface AdminRouteAudit {
  /** Mọi endpoint `/admin/*` đã đăng ký. */
  readonly routes: readonly RouteKey[];
  /** Endpoint `/admin/*` không có middleware `requireAdmin` (và không thuộc `publicRoutes`). */
  readonly unguarded: readonly RouteKey[];
  /** Endpoint có guard nhưng không yêu cầu permission (và không thuộc `loginOnlyRoutes`). */
  readonly missingPermission: readonly RouteKey[];
}

/** Danh sách endpoint (bỏ middleware toàn cục `*` / `/*`) theo thứ tự đăng ký. */
export function endpointKeys(routes: readonly RouteRecord[], prefix = '/'): RouteKey[] {
  const keys = new Set<RouteKey>();
  for (const r of routes) {
    if (r.method === 'ALL' || r.path.includes('*') || !r.path.startsWith(prefix)) continue;
    keys.add(`${r.method} ${r.path}` as RouteKey);
  }
  return [...keys];
}

/** Endpoint có tham số đường dẫn (`:id`) dưới `prefix` — đầu vào cho bảng test IDOR. */
export function paramEndpointKeys(routes: readonly RouteRecord[], prefix: string): RouteKey[] {
  return endpointKeys(routes, prefix).filter((key) => key.includes('/:'));
}

/** Middleware đăng ký ở `pattern` (vd `/admin/*`, `*`) có chạy cho `path` không. */
function patternCovers(pattern: string, path: string): boolean {
  if (pattern === path || pattern === '*' || pattern === '/*') return true;
  return pattern.endsWith('/*') && path.startsWith(pattern.slice(0, -1));
}

/**
 * Rà mọi endpoint `/admin/*` (BE-S7-07, AC1): phải có middleware do `requireAdmin(...)` tạo (nhận biết qua
 * `adminGuardMark`) gắn trên chính route hoặc trên wildcard bao route đó, và guard phải yêu cầu permission.
 */
export function auditAdminRoutes(
  routes: readonly RouteRecord[],
  options: AdminRouteAuditOptions,
): AdminRouteAudit {
  const publicRoutes = new Set(options.publicRoutes);
  const loginOnly = new Set(options.loginOnlyRoutes);
  const keys = endpointKeys(routes, '/admin/');
  const unguarded: RouteKey[] = [];
  const missingPermission: RouteKey[] = [];

  for (const key of keys) {
    if (publicRoutes.has(key)) continue;
    const [method, path] = key.split(' ') as [string, string];
    const guards = routes
      .filter((r) => (r.method === method || r.method === 'ALL') && patternCovers(r.path, path))
      .map((r) => adminGuardMark(r.handler))
      .filter((mark) => mark !== undefined);
    if (guards.length === 0) unguarded.push(key);
    else if (!loginOnly.has(key) && guards.every((g) => g.permission === undefined))
      missingPermission.push(key);
  }
  return { routes: keys, unguarded, missingPermission };
}
