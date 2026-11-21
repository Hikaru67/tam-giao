import type { Tx } from '@tamgiao/kernel';

/** Thời gian nghỉ sau khi dừng tìm hiểu (`COOLDOWN_DAYS`). Người dùng đang cooldown khi `now < until`. */
export interface CooldownRepository {
  /** `true` khi có cooldown và `now < until` (đúng thời điểm `until` → đã hết cooldown). */
  isCooling(tx: Tx, userId: string, now: Date): Promise<boolean>;

  /**
   * Bắt đầu / gia hạn cooldown tới `until`. Gọi lặp lại giữ `until` lớn hơn (không bao giờ rút ngắn cooldown đang có)
   * → idempotent khi job/consumer chạy lại (A9). `now` ghi vào `updated_at` (A7: thời gian do caller lấy từ `Clock`).
   */
  start(tx: Tx, userId: string, until: Date, now: Date): Promise<void>;
}
