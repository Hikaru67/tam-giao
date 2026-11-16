import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Db = NodePgDatabase;

export interface Database {
  readonly db: Db;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  /** Số connection tối đa trong pool. */
  readonly maxConnections?: number;
}

/** Tạo kết nối Postgres + Drizzle. Gọi một lần ở composition root (apps/api, apps/worker). */
export function createDatabase(url: string, options: DatabaseOptions = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max: options.maxConnections ?? 10 });
  const db = drizzle(pool);
  return { db, pool, close: () => pool.end() };
}
