import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { domainError } from '@tamgiao/kernel';
import { handleError, handleNotFound, problemResponse, requestContext, type AppEnv } from '@tamgiao/http';
import type { Logger } from '@tamgiao/config';
import type { ApiModule } from './modules.js';
import * as contracts from '@tamgiao/contracts';
import { timingSafeEqual } from 'node:crypto';
import type { ApiMetrics } from './observability/metrics.js';
import { buildOpenApiDocument, openApiHtml } from './observability/openapi.js';

export interface ReadinessCheck {
  readonly name: string;
  readonly check: () => Promise<void>;
}

export interface AppDeps {
  readonly logger: Logger;
  readonly modules: readonly ApiModule[];
  readonly readinessChecks: readonly ReadinessCheck[];
  readonly corsOrigins: readonly string[];
  readonly bodyLimitBytes: number;
  readonly trustProxy?: boolean;
  readonly observability?: ObservabilityDeps;
}

/** Metric + tài liệu OpenAPI (BE-S7-08). Bỏ trống = tắt. */
export interface ObservabilityDeps {
  readonly metrics?: ApiMetrics;
  /** Có giá trị → `GET /metrics` yêu cầu `Authorization: Bearer <token>`. */
  readonly metricsToken?: string | undefined;
  /** Bật `GET /openapi.json` + `GET /docs`. */
  readonly openApi?: {
    readonly title: string;
    readonly version: string;
    readonly serverUrl?: string | undefined;
  };
}

/** Dựng Hono app (không mở cổng) — để test bằng `app.request()` và để `main.ts` phục vụ. */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { metrics, metricsToken, openApi } = deps.observability ?? {};

  // Đo trước mọi middleware khác để độ trễ gồm cả parse/guard.
  if (metrics) app.use('*', metrics.middleware);
  app.use('*', requestContext(deps.logger, { trustProxy: deps.trustProxy ?? false }));
  if (deps.corsOrigins.length > 0) {
    app.use('*', cors({ origin: [...deps.corsOrigins], exposeHeaders: ['x-request-id'] }));
  }
  app.use(
    '*',
    bodyLimit({
      maxSize: deps.bodyLimitBytes,
      onError: (c) => problemResponse(c, domainError('PAYLOAD_TOO_LARGE')),
    }),
  );

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/ready', async (c) => {
    const results = await Promise.all(
      deps.readinessChecks.map(async ({ name, check }) => {
        try {
          await check();
          return { name, ok: true };
        } catch (error) {
          c.get('logger').warn({ check: name, err: error }, 'readiness check failed');
          return { name, ok: false };
        }
      }),
    );
    const ready = results.every((r) => r.ok);
    return c.json(
      {
        status: ready ? 'ready' : 'not_ready',
        checks: Object.fromEntries(results.map((r) => [r.name, r.ok])),
      },
      ready ? 200 : 503,
    );
  });

  if (metrics) {
    app.get('/metrics', async (c) => {
      if (metricsToken && !bearerMatches(c.req.header('authorization'), metricsToken)) {
        return problemResponse(c, domainError('UNAUTHENTICATED'));
      }
      return c.body(await metrics.registry.metrics(), 200, { 'content-type': metrics.registry.contentType });
    });
  }

  for (const module of deps.modules) {
    app.route('/', module.routes);
  }

  if (openApi) {
    // Dựng một lần, sau khi mọi route module đã đăng ký.
    let document: Record<string, unknown> | undefined;
    app.get('/openapi.json', (c) =>
      c.json(
        (document ??= buildOpenApiDocument({ ...openApi, routes: app.routes, schemaModule: contracts })),
      ),
    );
    app.get('/docs', (c) => c.html(openApiHtml('/openapi.json')));
  }

  app.notFound(handleNotFound);
  app.onError(handleError);
  return app;
}

function bearerMatches(header: string | undefined, token: string): boolean {
  const provided = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
