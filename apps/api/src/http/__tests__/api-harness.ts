import { createLogger, type Logger } from '@tamgiao/config';
import type { AppEnv } from '@tamgiao/http';
import {
  addDuration,
  type Clock,
  type ObjectStorage,
  type Scheduler,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { SmsMessage } from '@tamgiao/module-identity';
import type { MessageBroadcaster } from '@tamgiao/module-messaging';
import type { Hono } from 'hono';
import { createApp } from '../../app.js';
import { parseApiConfig } from '../../config.js';
import { buildModules } from '../../modules.js';

/**
 * Dựng **đúng composition của apps/api** (`buildModules` + `createApp`) với Fake cho hạ tầng bên ngoài (SMS, S3,
 * Redis) — dùng cho test meta route admin và test IDOR (BE-S7-07). `uow` do test truyền: Postgres thật (int) hoặc
 * stub ném lỗi (unit, chỉ gọi route bị guard chặn trước khi chạm DB).
 */
export const TEST_API_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test-secret',
  DATA_MASTER_KEYS: `1:${Buffer.alloc(32, 7).toString('base64')}`,
  BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString('base64'),
  AUTH_SECRET: Buffer.alloc(32, 11).toString('base64'),
  PAYMENT_WEBHOOK_SECRET: 'test-payment-webhook-secret',
} as const;

/** Broadcaster không cần Redis (chat realtime không thuộc phạm vi các test này). */
export class NoopBroadcaster implements MessageBroadcaster {
  async publish(): Promise<void> {}
  async subscribe(): Promise<() => Promise<void>> {
    return async () => undefined;
  }
  async close(): Promise<void> {}
}

/** Object storage giả: presign trả URL giả, `head` coi như object tồn tại. */
export function fakeStorage(clock: Clock): ObjectStorage {
  const presigned = (method: 'GET' | 'PUT', bucket: string, key: string) => ({
    url: `https://storage.test/${bucket}/${key}`,
    method,
    headers: {},
    expiresAt: addDuration(clock.now(), { minutes: 5 }),
  });
  return {
    presignPut: async ({ bucket, key }) => presigned('PUT', bucket, key),
    presignGet: async ({ bucket, key }) => presigned('GET', bucket, key),
    head: async () => ({ contentType: 'image/jpeg', sizeBytes: 1_024 }),
    delete: async () => undefined,
  };
}

/** UnitOfWork cho test không có DB: route nào chạm DB là lỗi của test. */
export const noDatabaseUow: UnitOfWork = {
  run: async () => {
    throw new Error('test này không có database — route đã chạm DB trước khi guard chặn');
  },
};

export interface TestApi {
  readonly app: Hono<AppEnv>;
  /** Tin SMS đã "gửi" (lấy mã OTP). */
  readonly sms: SmsMessage[];
}

export function buildTestApi(deps: {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly scheduler?: Scheduler;
  readonly logger?: Logger;
}): TestApi {
  const sms: SmsMessage[] = [];
  const logger = deps.logger ?? createLogger({ service: 'api', level: 'silent' });
  const modules = buildModules({
    config: parseApiConfig({ ...TEST_API_ENV }),
    uow: deps.uow,
    clock: deps.clock,
    scheduler: deps.scheduler ?? { schedule: async () => undefined },
    logger,
    adapters: {
      smsSender: { send: async (message) => void sms.push(message) },
      storage: fakeStorage(deps.clock),
      broadcaster: new NoopBroadcaster(),
    },
  });
  const app = createApp({ logger, modules, readinessChecks: [], corsOrigins: [], bodyLimitBytes: 1_048_576 });
  return { app, sms };
}
