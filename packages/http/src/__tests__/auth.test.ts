import { fail, ok } from '@tamgiao/kernel';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { bearerToken, requireUser, type UserAuthenticator } from '../auth.js';
import type { AppEnv } from '../context.js';

const authenticate: UserAuthenticator = async (token) => {
  if (token === 'valid') return ok({ userId: 'u-1', sessionId: 's-1' });
  if (token === 'expired') return fail('TOKEN_EXPIRED');
  return fail('UNAUTHENTICATED');
};

function app() {
  const a = new Hono<AppEnv>();
  a.get('/me', requireUser(authenticate), (c) => c.json(c.get('auth')));
  return a;
}

const get = (authorization?: string) =>
  app().request('/me', { headers: authorization ? { authorization } : {} });

describe('requireUser', () => {
  it('token hợp lệ → gọi handler với userId/sessionId trong context', async () => {
    const res = await get('Bearer valid');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'u-1', sessionId: 's-1' });
  });

  it('thiếu header Authorization → 401 UNAUTHENTICATED (AC2)', async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('token hết hạn → 401 TOKEN_EXPIRED (AC2)', async () => {
    const res = await get('Bearer expired');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('token sai / sai scheme → 401 UNAUTHENTICATED', async () => {
    for (const header of ['Bearer wrong', 'Basic dXNlcjpwYXNz', 'valid', 'Bearer ']) {
      const res = await get(header);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });
});

describe('bearerToken', () => {
  it('tách token, từ chối khoảng trắng / ký tự lạ', () => {
    expect(bearerToken('Bearer a.b-c_d')).toBe('a.b-c_d');
    expect(bearerToken('Bearer a b')).toBeUndefined();
    expect(bearerToken('bearer abc')).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});
