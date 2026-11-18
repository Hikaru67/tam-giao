import { fail, ok } from '@tamgiao/kernel';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createRequireAdmin, type AdminAuthenticator } from '../admin-auth.js';
import type { AppEnv } from '../context.js';

const authenticate: AdminAuthenticator = async (token) => {
  if (token === 'matchmaker') {
    return ok({ adminId: 'a-1', sessionId: 's-1', role: 'MATCHMAKER', permissions: ['match:propose'] });
  }
  if (token === 'reviewer') {
    return ok({ adminId: 'a-2', sessionId: 's-2', role: 'REVIEWER', permissions: ['kyc:review'] });
  }
  return fail('UNAUTHENTICATED');
};
const requireAdmin = createRequireAdmin(authenticate);

const app = new Hono<AppEnv>();
app.get('/admin/kyc', requireAdmin('kyc:review'), (c) => c.json({ adminId: c.get('admin').adminId }));
app.get('/admin/me', requireAdmin(), (c) => c.json({ role: c.get('admin').role }));

const get = (path: string, token?: string) =>
  app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('requireAdmin', () => {
  it('role có permission → vào được, gắn admin vào context', async () => {
    const res = await get('/admin/kyc', 'reviewer');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adminId: 'a-2' });
  });

  it('MATCHMAKER gọi route cần kyc:review → 403 FORBIDDEN (AC2)', async () => {
    const res = await get('/admin/kyc', 'matchmaker');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('không yêu cầu permission → chỉ cần đăng nhập', async () => {
    expect((await get('/admin/me', 'matchmaker')).status).toBe(200);
  });

  it('thiếu / sai token → 401 UNAUTHENTICATED', async () => {
    for (const token of [undefined, 'bogus']) {
      const res = await get('/admin/kyc', token);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });
});
