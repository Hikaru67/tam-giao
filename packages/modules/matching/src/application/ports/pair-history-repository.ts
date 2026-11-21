import type { Tx } from '@tamgiao/kernel';

/**
 * Lịch sử cặp đã được đề xuất, để không đề xuất lại (`PAIR_ALREADY_TRIED`). Cặp không có thứ tự: (A, B) ≡ (B, A).
 * `outcome` là trạng thái kết thúc của match (vd `DECLINED`, `EXPIRED`, `CLOSED_STOPPED`) — chuỗi do domain quyết định.
 */
export interface PairHistoryRepository {
  /** Ghi (hoặc ghi đè bằng) kết quả gần nhất của cặp. `userA === userB` hoặc `outcome` rỗng → lỗi lập trình (throw). */
  record(tx: Tx, userA: string, userB: string, outcome: string, matchId: string, now: Date): Promise<void>;

  /** Cặp đã từng được đề xuất (có bản ghi lịch sử, bất kể kết quả). */
  hasTried(tx: Tx, userA: string, userB: string): Promise<boolean>;
}

/**
 * Chuẩn hoá cặp thành `[low, high]` (uuid chữ thường; thứ tự chuỗi trùng thứ tự `uuid` của Postgres vì Postgres so
 * sánh theo byte). Cùng một người hai phía → lỗi lập trình.
 */
export function orderPair(userA: string, userB: string): readonly [low: string, high: string] {
  const a = userA.toLowerCase();
  const b = userB.toLowerCase();
  if (a === b) throw new Error('pair_history: hai phía của cặp phải là hai người khác nhau');
  return a < b ? [a, b] : [b, a];
}
