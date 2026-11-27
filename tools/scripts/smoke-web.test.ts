import { describe, expect, it } from 'vitest';
import { WebSmokeFailure, runWebSmoke, type WebSmokeTarget } from './smoke-web.js';

const API_URL = 'https://api.staging.test/v1';
const API_ORIGIN = 'https://api.staging.test';
const ADMIN_URL = 'https://admin.staging.test';
const PARTNER_URL = 'https://partner.staging.test';

interface FakeWebOverrides {
  readonly csp?: string | null;
  readonly scriptBody?: string;
  readonly nosniff?: boolean;
  readonly fallbackStatus?: number;
  readonly manifestStatus?: number;
}

function buildHtml(csp: string | null): string {
  const cspMeta = csp === null ? '' : `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
  return [
    '<!doctype html>',
    '<html lang="vi">',
    `<head><meta charset="utf-8" />${cspMeta}</head>`,
    '<body><div id="root"></div><script type="module" crossorigin src="/assets/index-abc.js"></script></body>',
    '</html>',
  ].join('');
}

function fakeWebFetch(overrides: FakeWebOverrides = {}) {
  const calls: string[] = [];
  const csp =
    overrides.csp === undefined ? `default-src 'self'; connect-src 'self' ${API_ORIGIN}` : overrides.csp;
  const scriptBody = overrides.scriptBody ?? `const apiBase="${API_ORIGIN}";console.error(apiBase);`;
  const nosniff = overrides.nosniff ?? true;
  const fallbackStatus = overrides.fallbackStatus ?? 200;
  const manifestStatus = overrides.manifestStatus ?? 200;

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(`${url.origin}${url.pathname}`);

    if (url.pathname === '/') {
      const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
      if (nosniff) headers['x-content-type-options'] = 'nosniff';
      return new Response(buildHtml(csp), { status: 200, headers });
    }

    if (url.pathname === '/assets/index-abc.js') {
      return new Response(scriptBody, {
        status: 200,
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
      });
    }

    if (url.pathname === '/__smoke_deep_link__') {
      return new Response(fallbackStatus === 200 ? buildHtml(csp) : 'Not Found', {
        status: fallbackStatus,
        headers: { 'content-type': fallbackStatus === 200 ? 'text/html; charset=utf-8' : 'text/plain' },
      });
    }

    if (url.pathname === '/manifest.webmanifest') {
      return new Response(manifestStatus === 200 ? '{"name":"Tâm Giao Đối tác"}' : 'Not Found', {
        status: manifestStatus,
        headers: { 'content-type': 'application/manifest+json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  }) as typeof fetch;

  return { fetchImpl, calls };
}

async function expectFailureAt(
  targets: readonly WebSmokeTarget[],
  overrides: FakeWebOverrides,
  expectedStepName: string,
): Promise<WebSmokeFailure> {
  const { fetchImpl } = fakeWebFetch(overrides);
  const run = runWebSmoke({ targets, apiUrl: API_URL, fetch: fetchImpl });
  await expect(run).rejects.toBeInstanceOf(WebSmokeFailure);
  const err = await run.catch((error: unknown) => error);
  if (!(err instanceof WebSmokeFailure)) {
    throw new Error('Expected WebSmokeFailure');
  }
  expect(err.steps.at(-1)).toMatchObject({ name: expectedStepName, ok: false });
  return err;
}

describe('runWebSmoke', () => {
  it('pass toàn bộ bước cho admin và partner', async () => {
    const { fetchImpl } = fakeWebFetch();
    const lines: string[] = [];

    const steps = await runWebSmoke({
      targets: [
        { name: 'admin', url: `${ADMIN_URL}/` },
        { name: 'partner', url: PARTNER_URL },
      ],
      apiUrl: API_URL,
      fetch: fetchImpl,
      log: (line) => lines.push(line),
    });

    expect(steps.map((s) => [s.name, s.ok])).toEqual([
      ['admin: GET /', true],
      ['admin: meta CSP', true],
      ['admin: JS bundle', true],
      ['admin: header X-Content-Type-Options', true],
      ['admin: SPA fallback', true],
      ['partner: GET /', true],
      ['partner: meta CSP', true],
      ['partner: JS bundle', true],
      ['partner: header X-Content-Type-Options', true],
      ['partner: SPA fallback', true],
      ['partner: PWA manifest', true],
    ]);
    expect(lines.every((line) => line.startsWith('PASS '))).toBe(true);
  });

  it('thiếu thẻ meta CSP → fail đúng bước', async () => {
    await expectFailureAt([{ name: 'admin', url: ADMIN_URL }], { csp: null }, 'admin: meta CSP');
  });

  it('CSP không chứa API origin → fail đúng bước', async () => {
    await expectFailureAt(
      [{ name: 'admin', url: ADMIN_URL }],
      { csp: "default-src 'self'; connect-src 'self' https://wrong.example.test" },
      'admin: meta CSP',
    );
  });

  it('bundle trỏ localhost (không chứa API origin) → fail đúng bước', async () => {
    await expectFailureAt(
      [{ name: 'admin', url: ADMIN_URL }],
      { scriptBody: 'const apiBase="http://localhost:3000";' },
      'admin: JS bundle',
    );
  });

  it('thiếu header X-Content-Type-Options: nosniff → fail kèm hướng dẫn runbook', async () => {
    const failure = await expectFailureAt(
      [{ name: 'admin', url: ADMIN_URL }],
      { nosniff: false },
      'admin: header X-Content-Type-Options',
    );
    expect(failure.steps.at(-1)?.detail).toBe(
      'thiếu header — cấu hình reverse proxy theo docs/runbooks/fe-release.md',
    );
  });

  it('SPA fallback trả 404 → fail đúng bước', async () => {
    await expectFailureAt(
      [{ name: 'admin', url: ADMIN_URL }],
      { fallbackStatus: 404 },
      'admin: SPA fallback',
    );
  });

  it('partner thiếu manifest.webmanifest → fail đúng bước', async () => {
    await expectFailureAt(
      [{ name: 'partner', url: PARTNER_URL }],
      { manifestStatus: 404 },
      'partner: PWA manifest',
    );
  });

  it('chỉ có admin target → không kiểm manifest', async () => {
    const { fetchImpl, calls } = fakeWebFetch({ manifestStatus: 404 });

    const steps = await runWebSmoke({
      targets: [{ name: 'admin', url: ADMIN_URL }],
      apiUrl: API_URL,
      fetch: fetchImpl,
    });

    expect(steps).toHaveLength(5);
    expect(steps.every((s) => s.ok)).toBe(true);
    expect(calls.some((call) => call.endsWith('/manifest.webmanifest'))).toBe(false);
  });
});
