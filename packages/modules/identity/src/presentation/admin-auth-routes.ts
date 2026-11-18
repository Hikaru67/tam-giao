import { adminLoginBodySchema } from '@tamgiao/contracts';
import { bearerToken, parseBody, sendResult, type AppEnv, type RequireAdmin } from '@tamgiao/http';
import { Hono } from 'hono';
import type { AdminLogin } from '../application/use-cases/admin-login.js';
import type { AdminLogout } from '../application/use-cases/admin-logout.js';

export interface AdminAuthRoutesDeps {
  readonly adminLogin: AdminLogin;
  readonly adminLogout: AdminLogout;
  readonly requireAdmin: RequireAdmin;
}

export function createAdminAuthRoutes(deps: AdminAuthRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post('/admin/auth/login', async (c) => {
    const body = await parseBody(c, adminLoginBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.adminLogin.execute(body.value);
    return sendResult(
      c,
      result.map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString() })),
    );
  });

  routes.post('/admin/auth/logout', deps.requireAdmin(), async (c) => {
    // requireAdmin đã kiểm tra header hợp lệ.
    const token = bearerToken(c.req.header('authorization'));
    if (token) await deps.adminLogout.execute(token);
    return c.body(null, 204);
  });

  routes.get('/admin/auth/me', deps.requireAdmin(), (c) => {
    const { adminId, role, permissions } = c.get('admin');
    return c.json({ adminId, role, permissions });
  });

  return routes;
}
