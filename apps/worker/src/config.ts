import { envLogLevel, envNodeEnv, envPostgresUrl, loadEnvOrExit, parseEnv, type Env } from '@tamgiao/config';
import { z } from 'zod';

// Worker chỉ cần DB ở Sprint 1; biến cho storage/push được thêm ở task dùng tới (BE-S3-06, BE-S7-05).
const workerEnvSchema = z
  .object({
    NODE_ENV: envNodeEnv.default('development'),
    LOG_LEVEL: envLogLevel.default('info'),
    DATABASE_URL: envPostgresUrl,
  })
  .transform((e) => ({
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    database: { url: e.DATABASE_URL },
  }));

export type WorkerConfig = z.output<typeof workerEnvSchema>;

export const parseWorkerConfig = (env: Env): WorkerConfig => parseEnv('worker', workerEnvSchema, env);

export const loadWorkerConfig = (env: Env = process.env): WorkerConfig =>
  loadEnvOrExit('worker', workerEnvSchema, env);
