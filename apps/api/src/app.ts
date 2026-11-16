import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { domainError } from '@tamgiao/kernel';
import { requestContext, type AppEnv } from './http/context.js';
import { handleError, handleNotFound } from './http/errors.js';
import { problemResponse } from './http/problem.js';
import type { Logger } from '@tamgiao/config';
import type { ApiModule } from './modules.js';

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
}

/** Dựng Hono app (không mở cổng) — để test bằng `app.request()` và để `main.ts` phục vụ. */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', requestContext(deps.logger));
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

  for (const module of deps.modules) {
    app.route('/', module.routes);
  }

  app.notFound(handleNotFound);
  app.onError(handleError);
  return app;
}
