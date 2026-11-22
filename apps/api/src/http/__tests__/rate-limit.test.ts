import { createLogger } from '@tamgiao/config';
import { problemSchema } from '@tamgiao/contracts';
import { requestContext, type AppEnv } from '@tamgiao/http';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import {
  InMemoryRateLimitStore,
  SENSITIVE_ROUTES,
  apiRateLimitRules,
  rateLimit,
  type RateLimitStore,
} from '../rate-limit.js';

const logger = createLogger({ service: 'api', level: 'silent' });

function setup(
  store: RateLimitStore,
  rules = apiRateLimitRules({
    globalPerMinute: 5,
    otpPerMinute: 2,
    loginPerMinute: 2,
    dataRightsPerHour: 1,
  }),
) {
  const app = new Hono<AppEnv>();
  app.use('*', requestContext(logger, { trustProxy: true }));
  app.use('*', rateLimit({ store, rules }));
  app.all('*', (c) => c.json({ ok: true }));
  const call = (method: string, path: string, ip = '203.0.113.1') =>
    app.request(path, { method, headers: { 'x-forwarded-for': ip } });
  return { app, call };
}

describe('InMemoryRateLimitStore', () => {
  it('đếm trong cửa sổ cố định, reset khi hết cửa sổ', async () => {
    let now = 1_000;
    const store = new InMemoryRateLimitStore(() => now);
    expect(await store.hit('k', 60)).toEqual({ count: 1, resetInMs: 60_000 });
    now += 59_000;
    expect(await store.hit('k', 60)).toEqual({ count: 2, resetInMs: 1_000 });
    now += 1_000;
    expect(await store.hit('k', 60)).toEqual({ count: 1, resetInMs: 60_000 });
    expect((await store.hit('other', 60)).count).toBe(1);
  });
});

describe('rateLimit middleware', () => {
  it('luật toàn cục: vượt giới hạn → 429 RATE_LIMITED + Retry-After; IP khác không bị ảnh hưởng', async () => {
    const { call } = setup(new InMemoryRateLimitStore());
    for (let i = 0; i < 5; i++) expect((await call('GET', '/me')).status).toBe(200);
    const limited = await call('GET', '/me');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = problemSchema.parse(await limited.json());
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.meta).toMatchObject({ retryAfterSeconds: expect.any(Number) });
    expect((await call('GET', '/me', '203.0.113.2')).status).toBe(200);
  });

  it('/health, /ready, /metrics không bị luật toàn cục đếm', async () => {
    const { call } = setup(new InMemoryRateLimitStore());
    for (let i = 0; i < 10; i++) expect((await call('GET', '/health')).status).toBe(200);
    expect((await call('GET', '/ready')).status).toBe(200);
    expect((await call('GET', '/me')).status).toBe(200);
  });

  it.each([
    ['OTP', SENSITIVE_ROUTES.otp, 2],
    ['đăng nhập admin/partner', SENSITIVE_ROUTES.login, 2],
    ['xuất dữ liệu / xoá tài khoản', SENSITIVE_ROUTES.dataRights, 1],
  ])('route nhạy cảm (%s) có giới hạn riêng, chặt hơn toàn cục', async (_name, routes, limit) => {
    for (const route of routes) {
      const { call } = setup(new InMemoryRateLimitStore());
      const [method, path] = route.split(' ') as [string, string];
      for (let i = 0; i < limit; i++) expect((await call(method, path)).status).toBe(200);
      expect((await call(method, path)).status, route).toBe(429);
      // Giới hạn nhóm không chặn route thường.
      expect((await call('GET', '/me')).status).toBe(200);
    }
  });

  it('nhóm route nhạy cảm dùng chung bộ đếm (đổi route trong nhóm không lách được)', async () => {
    const { call } = setup(new InMemoryRateLimitStore());
    expect((await call('POST', '/auth/otp/request')).status).toBe(200);
    expect((await call('POST', '/auth/otp/verify')).status).toBe(200);
    expect((await call('POST', '/me/account/deletion/otp')).status).toBe(429);
  });

  it('store lỗi → cho qua (fail-open), không 500', async () => {
    const broken: RateLimitStore = { hit: async () => Promise.reject(new Error('redis down')) };
    const { call } = setup(broken);
    expect((await call('POST', '/auth/otp/request')).status).toBe(200);
  });
});

describe('createApp gắn rate limit', () => {
  it('bật khi truyền `rateLimit`, 429 vẫn có header bảo mật', async () => {
    const routes = new Hono<AppEnv>();
    routes.get('/x', (c) => c.json({ ok: true }));
    const app = createApp({
      logger,
      modules: [{ name: 'test', routes }],
      readinessChecks: [],
      corsOrigins: [],
      bodyLimitBytes: 1_024,
      rateLimit: {
        store: new InMemoryRateLimitStore(),
        rules: [{ name: 'global', limit: 1, windowSeconds: 60 }],
      },
    });
    expect((await app.request('/x')).status).toBe(200);
    const limited = await app.request('/x');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await app.request('/health')).status).toBe(200);
  });
});
