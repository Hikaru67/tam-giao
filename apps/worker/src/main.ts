import { createLogger } from '@tamgiao/config';
import {
  DrizzleUnitOfWork,
  EventBus,
  OutboxRelay,
  createDatabase,
  registerConsumers,
  registerJob,
} from '@tamgiao/db';
import { PgBoss } from 'pg-boss';
import { loadWorkerConfig } from './config.js';
import { registerWorkers } from './registry.js';

/** Composition root của worker: relay outbox → hàng đợi consumer, và chạy job hẹn giờ. */
const SHUTDOWN_TIMEOUT_MS = 15_000;
const RELAY_INTERVAL_MS = 1_000;

const config = loadWorkerConfig();
const logger = createLogger({ service: 'worker', level: config.logLevel });
const database = createDatabase(config.database.url);
const uow = new DrizzleUnitOfWork(database.pool);

const boss = new PgBoss({ connectionString: config.database.url });
boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'));
await boss.start();

const bus = new EventBus();
const jobs = registerWorkers(bus);
await registerConsumers({ boss, uow, bus, logger });
for (const job of jobs) {
  await registerJob({ boss, uow, logger, ...job });
}

const relay = new OutboxRelay({ uow, boss, bus, logger });
relay.start(RELAY_INTERVAL_MS);
logger.info({ consumers: bus.list().length, jobs: jobs.length }, 'worker started');

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

  await relay.stop();
  await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS - 2_000 });
  await database.close();
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
