import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.js';

/** Thư mục migration ở root repo (do `pnpm db:generate` sinh ra). */
export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

/** Chạy toàn bộ migration chưa áp dụng (dùng cho test tích hợp và lúc deploy). */
export async function runMigrations(db: Db, migrationsFolder: string = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder });
}
