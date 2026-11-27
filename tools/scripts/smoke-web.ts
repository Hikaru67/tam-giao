import { pathToFileURL } from 'node:url';

/**
 * Smoke test sau deploy web tĩnh (admin + partner, FE-S6-05):
 * kiểm tra HTML, thẻ meta CSP chứa API origin, JS bundle tải được và trỏ đúng API,
 * header bảo mật `X-Content-Type-Options: nosniff`, SPA fallback và PWA manifest (partner).
 *
 * Chạy: `pnpm --filter @tamgiao/tools smoke:web` với biến môi trường:
 * - `SMOKE_API_URL` (bắt buộc): origin API đã cấu hình khi build (`VITE_API_URL`)
 * - `SMOKE_ADMIN_URL`: URL gốc của web admin (ít nhất một trong admin/partner)
 * - `SMOKE_PARTNER_URL`: URL gốc của partner PWA
 */
export interface WebSmokeTarget {
  readonly name: 'admin' | 'partner';
  readonly url: string;
}

export interface WebSmokeOptions {
  readonly targets: readonly WebSmokeTarget[];
  readonly apiUrl: string;
  readonly fetch?: typeof fetch;
  readonly log?: (line: string) => void;
}

export interface WebSmokeStep {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export class WebSmokeFailure extends Error {
  constructor(readonly steps: readonly WebSmokeStep[]) {
    super(`smoke failed at: ${steps.find((s) => !s.ok)?.name ?? 'unknown'}`);
    this.name = 'WebSmokeFailure';
  }
}

function extractCspMetaContent(html: string): string | undefined {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    if (!/\bhttp-equiv\s*=\s*(?:"Content-Security-Policy"|'Content-Security-Policy')/i.test(tag)) {
      continue;
    }
    const contentMatch = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const value = contentMatch?.[1] ?? contentMatch?.[2];
    if (value !== undefined) return value;
  }
  return undefined;
}

function extractModuleScripts(html: string): string[] {
  const srcs: string[] = [];
  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  for (const tag of scriptTags) {
    if (!/\btype\s*=\s*(?:"module"|'module'|module(?![\w-]))/i.test(tag)) continue;
    const srcMatch = /\bsrc\s*=\s*"([^"]+\.js)"/i.exec(tag) ?? /\bsrc\s*=\s*'([^']+\.js)'/i.exec(tag);
    const src = srcMatch?.[1];
    if (src) srcs.push(src);
  }
  return srcs;
}

export async function runWebSmoke(options: WebSmokeOptions): Promise<readonly WebSmokeStep[]> {
  const http = options.fetch ?? fetch;
  const log = options.log ?? (() => undefined);
  const apiOrigin = new URL(options.apiUrl).origin;
  const steps: WebSmokeStep[] = [];

  const record = (step: WebSmokeStep) => {
    steps.push(step);
    log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name}${step.detail ? ` — ${step.detail}` : ''}`);
    if (!step.ok) throw new WebSmokeFailure(steps);
  };

  if (options.targets.length === 0) {
    record({ name: 'targets', ok: false, detail: 'cần ít nhất một target' });
  }

  for (const target of options.targets) {
    const base = target.url.replace(/\/+$/, '');

    // 1. Trang gốc trả 200 text/html.
    const rootRes = await http(`${base}/`);
    const rootCt = rootRes.headers.get('content-type') ?? '';
    record({
      name: `${target.name}: GET /`,
      ok: rootRes.status === 200 && rootCt.toLowerCase().includes('text/html'),
      detail: `status ${rootRes.status}, content-type ${rootCt || 'thiếu'}`,
    });
    const html = await rootRes.text();

    // 2. HTML có meta CSP và chứa origin của API.
    const csp = extractCspMetaContent(html);
    const cspHasOrigin = csp !== undefined && csp.includes(apiOrigin);
    record({
      name: `${target.name}: meta CSP`,
      ok: cspHasOrigin,
      detail:
        csp === undefined
          ? 'thiếu thẻ <meta http-equiv="Content-Security-Policy">'
          : cspHasOrigin
            ? `chứa ${apiOrigin}`
            : `không chứa origin API (${apiOrigin})`,
    });

    // 3. Mọi <script type="module" src="...js"> tải được 200 và ít nhất 1 bundle chứa origin của API.
    const scriptSrcs = extractModuleScripts(html);
    if (scriptSrcs.length === 0) {
      record({
        name: `${target.name}: JS bundle`,
        ok: false,
        detail: 'không tìm thấy <script type="module" src="...js">',
      });
    }

    let bundleHasApiOrigin = false;
    for (const src of scriptSrcs) {
      const scriptUrl = new URL(src, `${base}/`).href;
      const scriptRes = await http(scriptUrl);
      if (scriptRes.status !== 200) {
        record({
          name: `${target.name}: JS bundle`,
          ok: false,
          detail: `GET ${src} trả về status ${scriptRes.status}`,
        });
      }
      const scriptBody = await scriptRes.text();
      if (scriptBody.includes(apiOrigin)) {
        bundleHasApiOrigin = true;
      }
    }
    record({
      name: `${target.name}: JS bundle`,
      ok: bundleHasApiOrigin,
      detail: bundleHasApiOrigin
        ? `${scriptSrcs.length} script(s), chứa ${apiOrigin}`
        : `không thấy origin API (${apiOrigin}) trong ${scriptSrcs.length} script(s)`,
    });

    // 4. Header bảo mật X-Content-Type-Options: nosniff từ reverse proxy / hosting.
    const nosniff = rootRes.headers.get('x-content-type-options')?.trim().toLowerCase();
    record({
      name: `${target.name}: header X-Content-Type-Options`,
      ok: nosniff === 'nosniff',
      detail:
        nosniff === 'nosniff'
          ? 'nosniff'
          : 'thiếu header — cấu hình reverse proxy theo docs/runbooks/fe-release.md',
    });

    // 5. SPA fallback: route client-side phải trả index.html (200 text/html).
    const fallbackRes = await http(`${base}/__smoke_deep_link__`);
    const fallbackCt = fallbackRes.headers.get('content-type') ?? '';
    record({
      name: `${target.name}: SPA fallback`,
      ok: fallbackRes.status === 200 && fallbackCt.toLowerCase().includes('text/html'),
      detail: `status ${fallbackRes.status}, content-type ${fallbackCt || 'thiếu'}`,
    });

    // 6. Riêng partner (PWA) kiểm tra manifest.webmanifest.
    if (target.name === 'partner') {
      const manifestRes = await http(`${base}/manifest.webmanifest`);
      record({
        name: `${target.name}: PWA manifest`,
        ok: manifestRes.status === 200,
        detail: `status ${manifestRes.status}`,
      });
    }
  }

  return steps;
}

async function main(): Promise<void> {
  const adminUrl = process.env.SMOKE_ADMIN_URL?.trim();
  const partnerUrl = process.env.SMOKE_PARTNER_URL?.trim();
  const apiUrl = process.env.SMOKE_API_URL?.trim();

  const targets: WebSmokeTarget[] = [];
  if (adminUrl) targets.push({ name: 'admin', url: adminUrl });
  if (partnerUrl) targets.push({ name: 'partner', url: partnerUrl });

  if (!apiUrl || targets.length === 0) {
    console.error(
      'Thiếu biến môi trường. Cần SMOKE_API_URL (bắt buộc) và ít nhất một trong SMOKE_ADMIN_URL, SMOKE_PARTNER_URL.',
    );
    process.exitCode = 2;
    return;
  }

  try {
    await runWebSmoke({ targets, apiUrl, log: (line) => console.log(line) });
    console.log('smoke web OK');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'smoke web failed');
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
