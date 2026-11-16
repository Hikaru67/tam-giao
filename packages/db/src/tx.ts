import type { Tx } from '@tamgiao/kernel';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

/** Drizzle gắn vào đúng connection đang mở transaction. Dùng như `db` bình thường. */
export type DbTx = NodePgDatabase;

/** Thứ thật nằm sau `Tx` trừu tượng: Drizzle + connection `pg` của cùng transaction. */
export interface DbTxHandle {
  readonly db: DbTx;
  readonly client: pg.PoolClient;
}

/**
 * Chuyển `Tx` (application chuyền qua) về Drizzle của transaction. Chỉ dùng trong infrastructure.
 * `Tx` luôn do `DrizzleUnitOfWork` tạo ra.
 */
export const asDbTx = (tx: Tx): DbTx => (tx as unknown as DbTxHandle).db;

/** Connection `pg` thô của transaction — cho thư viện cần SQL trực tiếp (vd pg-boss ghi job cùng transaction). */
export const asPgClient = (tx: Tx): pg.PoolClient => (tx as unknown as DbTxHandle).client;

export const toTx = (handle: DbTxHandle): Tx => handle as unknown as Tx;
