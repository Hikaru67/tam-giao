import type { Tx } from '@tamgiao/kernel';

/**
 * Danh sách tài khoản bị khoá vĩnh viễn phía identity (`identity.banned_users`, BE-S6-06) — bản sao tối thiểu từ event
 * `UserBanned` của safety (A3: identity không đọc bảng safety). Chỉ id + thời điểm, không lý do.
 */
export interface BannedUserRegistry {
  /** Idempotent: đánh dấu lại người đã bị khoá không đổi gì. */
  markBanned(tx: Tx, userId: string, bannedAt: Date): Promise<void>;
  isBanned(tx: Tx, userId: string): Promise<boolean>;
}
