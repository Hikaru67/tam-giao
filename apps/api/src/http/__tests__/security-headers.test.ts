import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '@tamgiao/http';
import {
  API_CONTENT_SECURITY_POLICY,
  DOCS_CONTENT_SECURITY_POLICY,
  securityHeaders,
} from '../security-headers.js';

describe('securityHeaders', () => {
  it('1. /x có content-security-policy === API_CONTENT_SECURITY_POLICY, x-content-type-options = nosniff, x-frame-options có giá trị, referrer-policy = no-referrer, strict-transport-security có giá trị, permissions-policy chứa camera=()', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', securityHeaders());
    app.get('/x', (c) => c.json({}));
    app.get('/docs', (c) => c.html('<html></html>'));

    const res = await app.request('/x');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(API_CONTENT_SECURITY_POLICY);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBeTruthy();
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
  });

  it('2. /docs có CSP === DOCS_CONTENT_SECURITY_POLICY, chứa https://cdn.jsdelivr.net, và không chứa unsafe-eval', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', securityHeaders());
    app.get('/x', (c) => c.json({}));
    app.get('/docs', (c) => c.html('<html></html>'));

    const res = await app.request('/docs');
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBe(DOCS_CONTENT_SECURITY_POLICY);
    expect(csp).toContain('https://cdn.jsdelivr.net');
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('3. Option docsPaths: ["/reference"] → /reference nhận docs CSP, /docs nhận API CSP', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', securityHeaders({ docsPaths: ['/reference'] }));
    app.get('/docs', (c) => c.html('<html></html>'));
    app.get('/reference', (c) => c.html('<html></html>'));

    const resReference = await app.request('/reference');
    expect(resReference.status).toBe(200);
    expect(resReference.headers.get('content-security-policy')).toBe(DOCS_CONTENT_SECURITY_POLICY);

    const resDocs = await app.request('/docs');
    expect(resDocs.status).toBe(200);
    expect(resDocs.headers.get('content-security-policy')).toBe(API_CONTENT_SECURITY_POLICY);
  });

  it('4. Response 404 (route không tồn tại, dùng app.notFound) vẫn có header bảo mật', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', securityHeaders());
    app.get('/x', (c) => c.json({}));
    app.notFound((c) => c.json({ error: 'not_found' }, 404));

    const res = await app.request('/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-security-policy')).toBe(API_CONTENT_SECURITY_POLICY);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
  });
});
