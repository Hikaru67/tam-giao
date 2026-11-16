import type { Result } from './result.js';

declare const TxBrand: unique symbol;

/**
 * Transaction trừu tượng. Application chỉ chuyền `tx` qua lại; infrastructure ép kiểu về transaction thật
 * (vd Drizzle). Repository nhận `tx` làm tham số, không tự mở transaction (AGENTS.md A5).
 */
export interface Tx {
  readonly [TxBrand]: true;
}

export interface UnitOfWork {
  /**
   * Chạy `work` trong một transaction.
   * - `work` trả `Ok` → commit.
   * - `work` trả `Err` → **rollback** (lỗi nghiệp vụ không được để lại dữ liệu ghi dở), rồi trả lại `Err` đó.
   * - `work` throw → rollback và ném lại lỗi.
   * Gọi lồng nhau trong cùng `work` phải dùng lại `tx` được truyền vào, không gọi `run` mới.
   */
  run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>>;
}
