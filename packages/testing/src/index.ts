import { err, type Tx, type UnitOfWork } from '@tamgiao/kernel';
import type pg from 'pg';
import { inject } from 'vitest';
import './provided-context.js';

/** URL Postgres của lượt chạy test tích hợp (do `postgres-global-setup` cung cấp). */
export function testDatabaseUrl(): string {
  return inject('databaseUrl');
}

/**
 * Schema không bao giờ bị xoá dữ liệu: lịch sử migration (`drizzle`) và bảng nội bộ của pg-boss
 * (`pgboss` — test dùng tên queue riêng thay vì xoá).
 */
const PROTECTED_SCHEMAS = new Set(['drizzle', 'pgboss', 'pg_catalog', 'information_schema', 'public']);

/**
 * Xoá sạch dữ liệu mọi bảng trong các schema ứng dụng (giữ cấu trúc + lịch sử migration).
 * Gọi trong `beforeEach` của test tích hợp. Test int chạy tuần tự từng file nên không giẫm chân nhau.
 */
export async function resetDatabase(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ schema: string; table: string }>(
    `select table_schema as schema, table_name as table
       from information_schema.tables
      where table_type = 'BASE TABLE'`,
  );
  const tables = rows
    .filter((r) => !PROTECTED_SCHEMAS.has(r.schema) && !r.schema.startsWith('pg_'))
    .map((r) => `"${r.schema}"."${r.table}"`);
  if (tables.length > 0) {
    await pool.query(`truncate table ${tables.join(', ')} restart identity cascade`);
  }
}

/** Chạy `fn` `n` lần **đồng thời**, trả kết quả từng lần (để test luật xuyên aggregate, AGENTS.md A10). */
export function runConcurrently<T>(
  n: number,
  fn: (index: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
}

const ROLLBACK = Symbol('withRollback');

/**
 * Chạy `fn` trong một transaction rồi **luôn rollback** (trả `Err` nội bộ cho UnitOfWork),
 * trả về giá trị `fn` tính được. Dùng để test repository mà không để lại dữ liệu.
 */
export async function withRollback<T>(uow: UnitOfWork, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let value: { readonly v: T } | undefined;
  await uow.run(async (tx) => {
    value = { v: await fn(tx) };
    return err(ROLLBACK);
  });
  if (value === undefined) throw new Error('withRollback: fn không trả về');
  return value.v;
}
