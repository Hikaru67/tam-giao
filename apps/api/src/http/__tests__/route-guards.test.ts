import { problemSchema } from '@tamgiao/contracts';
import { createRequireAdmin, requireUser, type AppEnv } from '@tamgiao/http';
import { FakeClock, domainError, err } from '@tamgiao/kernel';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { auditAdminRoutes, endpointKeys, type RouteKey } from '../route-audit.js';
import { buildTestApi, noDatabaseUow } from './api-harness.js';

/**
 * BE-S7-07 — test meta trên danh sách route **thật** của apps/api (`buildModules` + `createApp`, Fake cho hạ tầng ngoài).
 * AC1: route `/admin/*` nào không gắn `requireAdmin` (hoặc gắn mà không yêu cầu permission) → test fail kèm danh sách.
 */

/** Route admin công khai — chỉ thêm khi có lý do rõ (đăng nhập). */
const PUBLIC_ADMIN_ROUTES = ['POST /admin/auth/login'];
/** Route admin chỉ cần phiên admin hợp lệ, không cần permission (thao tác trên chính phiên của mình). */
const LOGIN_ONLY_ADMIN_ROUTES = ['POST /admin/auth/logout', 'GET /admin/auth/me'];

/**
 * Route `/me/*` + route của chính người dùng ngoài `/me` đều phải có phiên người dùng. Ngoại lệ công khai ngoài `/me`:
 * không thuộc phạm vi kiểm tra này (OTP, webhook, link tải có ký…).
 */
const clock = new FakeClock(new Date('2026-11-20T08:00:00.000Z'));
const { app } = buildTestApi({ uow: noDatabaseUow, clock });
const UUID = '0190d2c4-0000-7000-8000-000000000001';

/** Thay `:param` bằng UUID hợp lệ để gọi thử route. */
const concretePath = (path: string) => path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, UUID);

async function call(key: RouteKey, headers: Record<string, string> = {}) {
  const [method, path] = key.split(' ') as [string, string];
  return app.request(concretePath(path), {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
  });
}

describe('AC1 — mọi route /admin/* gắn requireAdmin (route thật của apps/api)', () => {
  const audit = auditAdminRoutes(app.routes, {
    publicRoutes: PUBLIC_ADMIN_ROUTES,
    loginOnlyRoutes: LOGIN_ONLY_ADMIN_ROUTES,
  });

  it('liệt kê được route admin của mọi module (kể cả dating mới)', () => {
    expect(audit.routes.length).toBeGreaterThan(30);
    expect(audit.routes).toEqual(
      expect.arrayContaining([
        'GET /admin/audit-logs',
        'POST /admin/kyc/submissions/:id/approve',
        'POST /admin/partners',
        'POST /admin/payments/:id/refund',
        'POST /admin/matches',
        'POST /admin/users/:id/ban',
        'GET /admin/dating/appearance-flags',
        'GET /admin/dating/feedbacks/:id',
      ]),
    );
  });

  it('không có route admin thiếu guard requireAdmin', () => {
    expect(audit.unguarded).toEqual([]);
  });

  it('mọi route admin (trừ phiên của chính mình) yêu cầu permission', () => {
    expect(audit.missingPermission).toEqual([]);
  });

  it('danh sách ngoại lệ không cũ: mọi route ngoại lệ vẫn tồn tại', () => {
    expect(audit.routes).toEqual(
      expect.arrayContaining([...PUBLIC_ADMIN_ROUTES, ...LOGIN_ONLY_ADMIN_ROUTES]),
    );
  });

  it('gọi mọi route admin (trừ công khai) không có phiên admin → 401 UNAUTHENTICATED, guard chạy trước handler', async () => {
    const failures: string[] = [];
    for (const key of audit.routes.filter((k) => !PUBLIC_ADMIN_ROUTES.includes(k))) {
      const res = await call(key);
      const body = problemSchema.safeParse(await res.json().catch(() => null));
      if (res.status !== 401 || body.data?.code !== 'UNAUTHENTICATED')
        failures.push(`${key} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('route /me/* bắt buộc phiên người dùng', () => {
  it('gọi mọi route /me/* không có token → 401', async () => {
    const keys = endpointKeys(app.routes, '/me');
    expect(keys.length).toBeGreaterThan(30);
    const failures: string[] = [];
    for (const key of keys) {
      const res = await call(key);
      if (res.status !== 401) failures.push(`${key} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('auditAdminRoutes phát hiện route thiếu guard (tự kiểm tra cơ chế)', () => {
  const requireAdmin = createRequireAdmin(async () => err(domainError('UNAUTHENTICATED')));
  const userGuard = requireUser(async () => err(domainError('UNAUTHENTICATED')));
  const options = { publicRoutes: ['POST /admin/auth/login'], loginOnlyRoutes: ['GET /admin/auth/me'] };

  it('route admin không guard, chỉ requireUser, hoặc guard không permission → bị liệt kê', () => {
    const routes = new Hono<AppEnv>();
    routes.post('/admin/auth/login', (c) => c.json({}));
    routes.get('/admin/auth/me', requireAdmin(), (c) => c.json({}));
    routes.get('/admin/ok/:id', requireAdmin('x:read'), (c) => c.json({}));
    routes.get('/admin/naked', (c) => c.json({}));
    routes.get('/admin/user-only', userGuard, (c) => c.json({}));
    routes.post('/admin/no-permission', requireAdmin(), (c) => c.json({}));
    const app = new Hono<AppEnv>().route('/', routes);

    const audit = auditAdminRoutes(app.routes, options);
    expect(audit.unguarded).toEqual(['GET /admin/naked', 'GET /admin/user-only']);
    expect(audit.missingPermission).toEqual(['POST /admin/no-permission']);
  });

  it('guard gắn qua wildcard (`use("/admin/x/*")`) được tính, đúng method', () => {
    const routes = new Hono<AppEnv>();
    routes.use('/admin/x/*', requireAdmin('x:read'));
    routes.get('/admin/x/list', (c) => c.json({}));
    routes.on('POST', '/admin/y/*', requireAdmin('y:write'));
    routes.get('/admin/y/list', (c) => c.json({}));

    const audit = auditAdminRoutes(routes.routes, options);
    expect(audit.unguarded).toEqual(['GET /admin/y/list']);
  });
});
