import type { Tx } from '@tamgiao/kernel';
import type { UserBan } from '../../domain/user-ban.js';

/** Lưu quyết định khoá (`safety.user_bans`). Mọi thao tác chạy trong `tx` của caller (A5). */
export interface UserBanRepository {
  /**
   * Thêm bản ghi khoá mới + ghi `UserBanned` vào outbox cùng `tx` (A6). Người dùng đã có bản ghi khoá (PK `user_id`,
   * A10 — kể cả hai admin khoá đồng thời) → trả `false`, không ghi gì.
   */
  insert(tx: Tx, ban: UserBan): Promise<boolean>;
}
