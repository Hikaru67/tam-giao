import { serve } from '@hono/node-server';
import { DrizzleUnitOfWork, createDatabase } from '@tamgiao/db';
import { SystemClock } from '@tamgiao/kernel';
import { createApp } from './app.js';
import { loadApiConfig } from './config.js';
import { createLogger } from '@tamgiao/config';
import { DATING_SCHEDULED_QUEUES } from '@tamgiao/module-dating';
import { MATCHING_SCHEDULED_QUEUES } from '@tamgiao/module-matching';
import { startApiJobScheduler } from './job-scheduler.js';
import { buildModules } from './modules.js';
import { readOutboxBacklog, readQueueDepths } from './observability/backlog.js';
import { createErrorReporter, withErrorReporting } from './observability/error-reporter.js';
import { createApiMetrics } from './observability/metrics.js';
import { InMemoryRateLimitStore, RedisRateLimitStore, apiRateLimitRules } from './http/rate-limit.js';
import { Redis } from 'ioredis';

/** Composition root: nối config → hạ tầng → module → HTTP server. Không chứa logic nghiệp vụ. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadApiConfig();
// Sentry (BE-S7-08): no-op khi thiếu SENTRY_DSN; logger.error/fatal được báo kèm (đã scrub PII).
const errorReporter = createErrorReporter({ ...config.observability.sentry, service: 'api' });
const logger = withErrorReporting(createLogger({ service: 'api', level: config.logLevel }), errorReporter);
const database = createDatabase(config.database.url);
// pg-boss chỉ để gửi job hẹn giờ cùng transaction (vd hết hạn match); worker mới chạy job.
const jobs = await startApiJobScheduler({
  connectionString: config.database.url,
  queues: [...MATCHING_SCHEDULED_QUEUES, ...DATING_SCHEDULED_QUEUES],
  onError: (error) => logger.error({ err: error }, 'pg-boss error'),
});

const modules = buildModules({
  config,
  uow: new DrizzleUnitOfWork(database.pool),
  clock: new SystemClock(),
  scheduler: jobs.scheduler,
  logger,
});
// Rate limit HTTP (BE-S7-07): Redis riêng cho bộ đếm (không dùng chung kết nối pub/sub của messaging).
const rateLimitRedis =
  config.http.rateLimit.enabled && config.http.rateLimit.store === 'redis'
    ? new Redis(config.redis.url, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
    : undefined;
rateLimitRedis?.on('error', (error: unknown) => logger.warn({ err: error }, 'rate limit redis error'));

const app = createApp({
  logger,
  modules,
  readinessChecks: [{ name: 'database', check: async () => void (await database.pool.query('select 1')) }],
  corsOrigins: config.http.corsOrigins,
  bodyLimitBytes: config.http.bodyLimitBytes,
  trustProxy: config.http.trustProxy,
  ...(config.http.rateLimit.enabled
    ? {
        rateLimit: {
          store: rateLimitRedis ? new RedisRateLimitStore(rateLimitRedis) : new InMemoryRateLimitStore(),
          rules: apiRateLimitRules(config.http.rateLimit.limits),
        },
      }
    : {}),
  observability: {
    ...(config.observability.metrics.enabled
      ? {
          metrics: createApiMetrics({
            outboxBacklog: () => readOutboxBacklog(database.pool),
            queueDepths: () => readQueueDepths(database.pool),
            onCollectError: (source, error) => logger.warn({ source, err: error }, 'metrics collect failed'),
          }),
          metricsToken: config.observability.metrics.token,
        }
      : {}),
    ...(config.observability.openApi.enabled
      ? {
          openApi: {
            title: 'Tâm Giao API',
            version: config.observability.release,
            serverUrl: config.observability.openApi.serverUrl,
          },
        }
      : {}),
  },
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info({ port: info.port, env: config.nodeEnv }, 'api listening');
});
// WebSocket (chat realtime, BE-S6-02) nghe sự kiện `upgrade` của cùng HTTP server.
for (const module of modules) await module.realtime?.attach(server);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => {
    logger.error('shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  // Đóng WS trước: `server.close` chờ mọi kết nối (kể cả WS đã upgrade) kết thúc.
  for (const module of modules) await module.realtime?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await jobs.stop();
  await rateLimitRedis?.quit();
  await database.close();
  await errorReporter.flush(2_000);
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
