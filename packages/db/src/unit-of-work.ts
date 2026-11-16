import type { Result, Tx, UnitOfWork } from '@tamgiao/kernel';
import type { Db } from './client.js';
import { toTx } from './tx.js';

/** Tín hiệu nội bộ để Drizzle rollback khi `work` trả `Err` (không phải lỗi thật). */
class RollbackOnErr extends Error {
  constructor() {
    super('rollback: work returned Err');
  }
}

/**
 * Hiện thực `UnitOfWork` bằng transaction Drizzle, theo đúng hợp đồng port trong kernel:
 * `Ok` → commit, `Err` → rollback rồi trả lại `Err`, throw → rollback rồi ném lại.
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Db) {}

  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    let outcome: Result<T, E> | undefined;
    try {
      await this.db.transaction(async (dbTx) => {
        outcome = await work(toTx(dbTx));
        if (outcome.isErr()) throw new RollbackOnErr();
      });
    } catch (error) {
      if (!(error instanceof RollbackOnErr)) throw error;
    }
    if (outcome === undefined) {
      throw new Error('DrizzleUnitOfWork: transaction kết thúc mà không có kết quả');
    }
    return outcome;
  }
}
