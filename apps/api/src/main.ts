import { serve } from '@hono/node-server';
import { createDatabase } from '@tamgiao/db';
import { createApp } from './app.js';
import { loadApiConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildModules } from './modules.js';

/** Composition root: nối config → hạ tầng → module → HTTP server. Không chứa logic nghiệp vụ. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadApiConfig();
const logger = createLogger({ level: config.logLevel });
const database = createDatabase(config.database.url);

const app = createApp({
  logger,
  modules: buildModules(),
  readinessChecks: [{ name: 'database', check: async () => void (await database.pool.query('select 1')) }],
  corsOrigins: config.http.corsOrigins,
  bodyLimitBytes: config.http.bodyLimitBytes,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info({ port: info.port, env: config.nodeEnv }, 'api listening');
});

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

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database.close();
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
