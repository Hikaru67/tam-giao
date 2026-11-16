import type { Tx } from '@tamgiao/kernel';
import type { Db } from './client.js';

/** Transaction thật của Drizzle. */
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Chuyển `Tx` trừu tượng (application chuyền qua) về transaction Drizzle.
 * Chỉ dùng trong infrastructure (repository, outbox). `Tx` luôn do `DrizzleUnitOfWork` tạo ra.
 */
export const asDbTx = (tx: Tx): DbTx => tx as unknown as DbTx;

/** Bọc transaction Drizzle thành `Tx` để truyền vào code application. */
export const toTx = (dbTx: DbTx): Tx => dbTx as unknown as Tx;
