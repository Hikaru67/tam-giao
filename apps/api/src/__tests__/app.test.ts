import { problemSchema, registerErrors } from '@tamgiao/contracts';
import { fail, ok } from '@tamgiao/kernel';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp, type ReadinessCheck } from '../app.js';
import type { AppEnv } from '../http/context.js';
import { sendResult } from '../http/problem.js';
import { createLogger } from '@tamgiao/config';

registerErrors('api-test', {
  TEST_USER_BUSY: { status: 409, title: 'Người dùng đang bận (test)' },
});

function setup(
  options: { readinessChecks?: ReadinessCheck[]; corsOrigins?: string[]; bodyLimitBytes?: number } = {},
) {
  const lines: string[] = [];
  const logger = createLogger({
    service: 'api',
    level: 'debug',
    destination: { write: (msg: string) => void lines.push(msg) },
  });

  const routes = new Hono<AppEnv>();
  routes.get('/test/ok', (c) => sendResult(c, ok({ hello: 'world' })));
  routes.get('/test/busy', (c) => sendResult(c, fail('TEST_USER_BUSY', { retryAfterSeconds: 30 })));
  routes.get('/test/unregistered', (c) => sendResult(c, fail('NOT_IN_REGISTRY')));
  routes.get('/test/boom', () => {
    throw new Error('boom: chi tiết nội bộ không được lộ');
  });
  routes.get('/test/log-pii', (c) => {
    c.get('logger').info(
      {
        phone: '0912345678',
        authorization: 'Bearer eyJ.secret',
        user: { cccdNumber: '001095012345', otp: '842913' },
        matchId: 'm-1',
      },
      'sensitive context',
    );
    return c.json({ ok: true });
  });
  routes.post('/test/echo', async (c) => c.json(await c.req.json()));

  const app = createApp({
    logger,
    modules: [{ name: 'test', routes }],
    readinessChecks: options.readinessChecks ?? [],
    corsOrigins: options.corsOrigins ?? [],
    bodyLimitBytes: options.bodyLimitBytes ?? 1_048_576,
  });
  const logs = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { app, lines, logs };
}

describe('health & ready', () => {
  it('GET /health → 200 và gắn x-request-id', async () => {
    const { app } = setup();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('dùng lại x-request-id hợp lệ từ client, thay thế giá trị không an toàn', async () => {
    const { app } = setup();
    const reused = await app.request('/health', { headers: { 'x-request-id': 'client-trace-123' } });
    expect(reused.headers.get('x-request-id')).toBe('client-trace-123');
    for (const unsafe of ['bad value <script>', 'short', `x${'y'.repeat(200)}`]) {
      const replaced = await app.request('/health', { headers: { 'x-request-id': unsafe } });
      expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('GET /ready → 200 khi mọi check đạt, 503 khi có check lỗi', async () => {
    const okApp = setup({ readinessChecks: [{ name: 'database', check: async () => {} }] }).app;
    const okRes = await okApp.request('/ready');
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ status: 'ready', checks: { database: true } });

    const { app, logs } = setup({
      readinessChecks: [
        { name: 'database', check: async () => Promise.reject(new Error('connection refused')) },
        { name: 'other', check: async () => {} },
      ],
    });
    const res = await app.request('/ready');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'not_ready', checks: { database: false, other: true } });
    expect(logs().some((l) => l.msg === 'readiness check failed' && l.check === 'database')).toBe(true);
  });
});

describe('ánh xạ kết quả → HTTP', () => {
  it('Ok → 200 JSON', async () => {
    const res = await setup().app.request('/test/ok');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: 'world' });
  });

  it('err nghiệp vụ → status theo registry + Problem JSON có code, traceId, meta (AC1)', async () => {
    const res = await setup().app.request('/test/busy');
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = problemSchema.parse(await res.json());
    expect(body).toMatchObject({
      type: 'urn:tamgiao:error:TEST_USER_BUSY',
      title: 'Người dùng đang bận (test)',
      status: 409,
      code: 'TEST_USER_BUSY',
      meta: { retryAfterSeconds: 30 },
    });
    expect(body.traceId).toBe(res.headers.get('x-request-id'));
  });

  it('mã lỗi chưa đăng ký → 500 và log lỗi để sửa', async () => {
    const { app, logs } = setup();
    const res = await app.request('/test/unregistered');
    expect(res.status).toBe(500);
    expect(logs().some((l) => l.msg === 'unregistered error code' && l.code === 'NOT_IN_REGISTRY')).toBe(
      true,
    );
  });

  it('exception không bắt → 500, log có stack, response không lộ stack/message (AC2)', async () => {
    const { app, logs } = setup();
    const res = await app.request('/test/boom');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('boom');
    expect(text).not.toContain('at ');
    expect(problemSchema.parse(JSON.parse(text)).code).toBe('INTERNAL_ERROR');
    const errorLog = logs().find((l) => l.msg === 'unhandled error') as
      { err?: { stack?: string } } | undefined;
    expect(errorLog?.err?.stack).toContain('boom');
  });

  it('route không tồn tại → 404 NOT_FOUND', async () => {
    const res = await setup().app.request('/khong-co');
    expect(res.status).toBe(404);
    expect(problemSchema.parse(await res.json()).code).toBe('NOT_FOUND');
  });

  it('body vượt giới hạn → 413 PAYLOAD_TOO_LARGE', async () => {
    const { app } = setup({ bodyLimitBytes: 1_024 });
    const res = await app.request('/test/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: 'x'.repeat(2_000) }),
    });
    expect(res.status).toBe(413);
    expect(problemSchema.parse(await res.json()).code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('logger', () => {
  it('che PII/secret trong log, giữ dữ liệu không nhạy cảm (AC3)', async () => {
    const { app, lines, logs } = setup();
    await app.request('/test/log-pii');
    const raw = lines.join('\n');
    for (const secret of ['0912345678', 'eyJ.secret', '001095012345', '842913']) {
      expect(raw).not.toContain(secret);
    }
    const entry = logs().find((l) => l.msg === 'sensitive context');
    expect(entry).toMatchObject({
      phone: '[REDACTED]',
      authorization: '[REDACTED]',
      user: { cccdNumber: '[REDACTED]', otp: '[REDACTED]' },
      matchId: 'm-1',
    });
    expect(typeof entry?.traceId).toBe('string');
  });

  it('log 1 dòng khi request kết thúc với method, path, status, thời gian', async () => {
    const { app, logs } = setup();
    await app.request('/health');
    expect(logs().find((l) => l.msg === 'request completed')).toMatchObject({
      method: 'GET',
      path: '/health',
      status: 200,
    });
  });
});

describe('CORS', () => {
  it('bật CORS cho origin được cấu hình, không trả header cho origin lạ', async () => {
    const { app } = setup({ corsOrigins: ['http://localhost:5173'] });
    const allowed = await app.request('/health', { headers: { origin: 'http://localhost:5173' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const denied = await app.request('/health', { headers: { origin: 'https://evil.example' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});
