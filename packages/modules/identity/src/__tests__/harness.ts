import { createLogger } from '@tamgiao/config';
import {
  DrizzleUnitOfWork,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  createDatabase,
  type Database,
} from '@tamgiao/db';
import { handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { FakeClock } from '@tamgiao/kernel';
import { testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createIdentityModule } from '../index.js';
import { RecordingSmsSender } from './fakes.js';

/** Dựng module identity thật trên Postgres của lượt test + Hono app giống apps/api (trace, logger, lỗi). */
export function createIdentityHarness() {
  const database: Database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  const clock = new FakeClock(new Date('2026-11-16T08:00:00.000Z'));
  const sms = new RecordingSmsSender();
  const logLines: string[] = [];
  const logger = createLogger({
    service: 'api',
    level: 'debug',
    destination: { write: (line: string) => void logLines.push(line) },
  });

  const module = createIdentityModule({
    uow: new DrizzleUnitOfWork(database.pool),
    clock,
    encryptor: new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) }),
    blindIndexer: new HmacBlindIndexer(Buffer.alloc(32, 9)),
    smsSender: sms,
    authSecret: Buffer.alloc(32, 11),
  });

  const app = new Hono<AppEnv>();
  app.use('*', requestContext(logger, { trustProxy: true }));
  app.route('/', module.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);

  const post = async (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
      body: JSON.stringify(body),
    });

  return { database, clock, sms, logLines, module, app, post };
}

export type IdentityHarness = ReturnType<typeof createIdentityHarness>;
