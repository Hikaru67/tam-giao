import type { Result, Tx, UnitOfWork } from '@tamgiao/kernel';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { toTx } from './tx.js';

/**
 * Hiện thực `UnitOfWork` trên một connection riêng của pool, theo đúng hợp đồng port trong kernel:
 * `Ok` → COMMIT, `Err` → ROLLBACK rồi trả lại `Err`, throw → ROLLBACK rồi ném lại.
 * Tự quản lý BEGIN/COMMIT để vừa có Drizzle vừa có connection `pg` thô của cùng transaction (`asPgClient`).
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: pg.Pool) {}

  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const client = await this.pool.connect();
    // false khi BEGIN/COMMIT/ROLLBACK lỗi → connection ở trạng thái không chắc chắn, huỷ thay vì trả lại pool.
    let healthy = true;
    try {
      await this.control(client, 'BEGIN', () => (healthy = false));
      let outcome: Result<T, E>;
      try {
        outcome = await work(toTx({ db: drizzle(client), client }));
      } catch (error) {
        healthy = await this.tryRollback(client);
        throw error;
      }
      if (outcome.isErr()) {
        healthy = await this.tryRollback(client);
        return outcome;
      }
      await this.control(client, 'COMMIT', () => (healthy = false));
      return outcome;
    } finally {
      client.release(!healthy);
    }
  }

  private async control(
    client: pg.PoolClient,
    statement: 'BEGIN' | 'COMMIT',
    onFail: () => void,
  ): Promise<void> {
    try {
      await client.query(statement);
    } catch (error) {
      onFail();
      throw error;
    }
  }

  private async tryRollback(client: pg.PoolClient): Promise<boolean> {
    try {
      await client.query('ROLLBACK');
      return true;
    } catch {
      return false;
    }
  }
}
