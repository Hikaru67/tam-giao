import type { Tx } from './unit-of-work.js';

export interface ScheduledJob {
  /** Hàng đợi (loại job), vd `matching.expire-match`. */
  readonly queue: string;
  /** Khoá chống trùng, quy ước `<aggregateId>:<version>`. Cùng `queue` + `key` → chỉ tồn tại 1 job. */
  readonly key: string;
  readonly runAt: Date;
  /** Dữ liệu tuần tự hoá được thành JSON, không chứa PII. */
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Hẹn giờ chạy job (đếm ngược 24h, 14 ngày, cooldown…). Job được ghi **trong cùng transaction** `tx`:
 * transaction rollback thì job cũng không tồn tại. Handler của job phải idempotent (AGENTS.md A9).
 */
export interface Scheduler {
  schedule(tx: Tx, job: ScheduledJob): Promise<void>;
}
