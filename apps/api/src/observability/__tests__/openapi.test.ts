import { createLogger } from '@tamgiao/config';
import * as contracts from '@tamgiao/contracts';
import type { AppEnv } from '@tamgiao/http';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { buildOpenApiDocument, collectSchemas, componentName, toOpenApiPath } from '../openapi.js';

type Doc = {
  openapi: string;
  info: { title: string; version: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, { tags: string[]; security?: unknown; parameters?: unknown[] }>>;
  components: { schemas: Record<string, { type?: string; properties?: Record<string, unknown> }> };
};

describe('OpenAPI helpers', () => {
  it('componentName bỏ hậu tố Schema, viết hoa chữ đầu', () => {
    expect(componentName('verifyOtpBodySchema')).toBe('VerifyOtpBody');
    expect(componentName('problemSchema')).toBe('Problem');
  });

  it('toOpenApiPath đổi :param → {param}, bỏ regex của Hono', () => {
    expect(toOpenApiPath('/admin/kyc/:id/notes')).toEqual({ path: '/admin/kyc/{id}/notes', params: ['id'] });
    expect(toOpenApiPath('/x/:id{[0-9]+}/y/:slug')).toEqual({
      path: '/x/{id}/y/{slug}',
      params: ['id', 'slug'],
    });
    expect(toOpenApiPath('/health')).toEqual({ path: '/health', params: [] });
  });

  it('collectSchemas: mọi Zod schema export từ contracts → JSON Schema (có DTO OTP + Problem)', () => {
    const schemas = collectSchemas(contracts);
    expect(schemas.Problem).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['code', 'status']),
    });
    expect(schemas.VerifyOtpBody).toMatchObject({
      type: 'object',
      properties: { phone: expect.any(Object), code: { type: 'string', pattern: '^\\d{6}$' } },
    });
    expect(schemas.VerifyOtpResponse).toBeDefined();
    // Không phải schema (hằng số, hàm) → bỏ qua.
    expect(Object.keys(schemas).every((k) => /^[A-Z]/.test(k))).toBe(true);
    expect(schemas.OtpTtlSeconds).toBeUndefined();
  });

  it('buildOpenApiDocument: gộp route trùng (middleware + handler), bỏ ALL/*, gắn security theo /me, /admin', () => {
    const doc = buildOpenApiDocument({
      title: 'T',
      version: '1',
      serverUrl: 'https://api.example.com',
      schemaModule: {},
      routes: [
        { method: 'ALL', path: '*' },
        { method: 'GET', path: '/health' },
        { method: 'GET', path: '/me/match' },
        { method: 'GET', path: '/me/match' },
        { method: 'POST', path: '/admin/auth/login' },
        { method: 'POST', path: '/admin/kyc/submissions/:id/approve' },
        { method: 'GET', path: '/metrics' },
      ],
    }) as unknown as Doc;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'https://api.example.com' }]);
    expect(Object.keys(doc.paths)).toEqual([
      '/admin/auth/login',
      '/admin/kyc/submissions/{id}/approve',
      '/health',
      '/me/match',
    ]);
    expect(doc.paths['/me/match']?.get?.security).toEqual([{ userBearer: [] }]);
    expect(doc.paths['/admin/auth/login']?.post?.security).toBeUndefined();
    expect(doc.paths['/admin/kyc/submissions/{id}/approve']?.post).toMatchObject({
      tags: ['admin/kyc'],
      security: [{ adminBearer: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    });
    expect(doc.paths['/health']?.get?.security).toBeUndefined();
  });
});

describe('GET /openapi.json + /docs', () => {
  it('liệt kê route thật của các module đã đăng ký + schema DTO từ contracts', async () => {
    const routes = new Hono<AppEnv>();
    routes.post('/auth/otp/request', (c) => c.json({}));
    routes.get('/me/conversations/:id/messages', (c) => c.json({}));
    const app = createApp({
      logger: createLogger({ service: 'api', level: 'fatal', destination: { write: () => undefined } }),
      modules: [{ name: 'test', routes }],
      readinessChecks: [],
      corsOrigins: [],
      bodyLimitBytes: 1_048_576,
      observability: { openApi: { title: 'Tâm Giao API', version: 'abc123' } },
    });

    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Doc;
    expect(doc.info).toEqual({ title: 'Tâm Giao API', version: 'abc123' });
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/auth/otp/request', '/me/conversations/{id}/messages', '/health', '/ready']),
    );
    expect(doc.paths['/openapi.json']).toBeUndefined();
    expect(doc.components.schemas.RequestOtpBody).toBeDefined();

    const html = await app.request('/docs');
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('data-url="/openapi.json"');
  });
});
