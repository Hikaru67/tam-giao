import { createLogger, envLogLevel, envPostgresUrl, loadEnvOrExit, type Logger } from '@tamgiao/config';
import { createDatabase, runMigrations, type Database } from '@tamgiao/db';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

/**
 * Chạy migration lúc deploy (BE-S7-08), có khoá: nhiều tiến trình (vd 2 lần deploy chồng nhau, nhiều replica
 * chạy cùng lúc) gọi đồng thời thì chỉ một bên chạy, bên kia chờ khoá rồi thấy không còn gì để chạy.
 *
 * Khoá là **advisory lock cấp session** trên một connection riêng, giữ suốt lúc migrate; connection rớt thì
 * Postgres tự nhả khoá (không kẹt khoá khi container bị kill).
 *
 * Chạy: `node --import tsx src/migrate.ts` (image api: `docker run --rm <image> migrate`).
 */

/** Khoá advisory (bigint) dành riêng cho migration — `hashtext('tamgiao.migrations')` cố định. */
export const MIGRATION_LOCK_KEY = 'tamgiao.migrations';

export interface MigrateWithLockOptions {
  readonly database: Database;
  readonly logger: Pick<Logger, 'info'>;
  /** Chờ khoá tối đa bao lâu (ms) trước khi bỏ cuộc. */
  readonly lockTimeoutMs?: number;
  readonly migrationsFolder?: string;
}

export async function migrateWithLock(options: MigrateWithLockOptions): Promise<void> {
  const { database, logger } = options;
  const client = await database.pool.connect();
  try {
    await client.query(`select set_config('lock_timeout', $1, false)`, [
      `${options.lockTimeoutMs ?? 300_000}ms`,
    ]);
    logger.info('waiting for migration lock');
    await client.query('select pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    try {
      logger.info('migration lock acquired, running migrations');
      await runMigrations(database.db, options.migrationsFolder);
      logger.info('migrations complete');
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

const migrateEnvSchema = z.object({
  LOG_LEVEL: envLogLevel.default('info'),
  DATABASE_URL: envPostgresUrl,
  MIGRATION_LOCK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
});

async function main(): Promise<void> {
  const env = loadEnvOrExit('migrate', migrateEnvSchema);
  const logger = createLogger({ service: 'migrate', level: env.LOG_LEVEL });
  const database = createDatabase(env.DATABASE_URL);
  try {
    await migrateWithLock({ database, logger, lockTimeoutMs: env.MIGRATION_LOCK_TIMEOUT_MS });
  } catch (error) {
    logger.error({ err: error }, 'migration failed');
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) await main();
