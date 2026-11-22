import type { Tx } from '@tamgiao/kernel';
import type { Match, MatchId } from '../../domain/match.js';

/** Lưu / tải aggregate `Match` (`matching.matches`). Mọi thao tác chạy trong `tx` của caller (A5). */
export interface MatchRepository {
  /**
   * Lưu match mới hoặc thay đổi: ghi `matching.matches`, mỗi event chờ phát một dòng `matching.match_events`
   * (append-only) và outbox — tất cả trong `tx` (A6). Kiểm tra version lạc quan: bản trong DB phải đúng version trước
   * các event đang chờ, lệch → throw (lỗi đồng thời; caller nên tải bằng `findByIdForUpdate`). Không có event → no-op.
   */
  save(tx: Tx, match: Match): Promise<void>;

  findById(tx: Tx, id: MatchId): Promise<Match | null>;

  /** Tải và khoá dòng (`SELECT … FOR UPDATE`) — dùng cho thao tác đổi trạng thái (BE-S5-05). */
  findByIdForUpdate(tx: Tx, id: MatchId): Promise<Match | null>;

  /** Match đang mở (`OFFERED | AWAITING_RESPONSE | DATING | MET`) của người dùng, nếu có. */
  findOpenByUser(tx: Tx, userId: string): Promise<Match | null>;

  /**
   * Match gần nhất (theo `offered_at`, rồi `id`) giữa hai người, bất kể trạng thái và thứ tự `user_a`/`user_b`
   * (BE-S6-05 — facade cho safety kiểm tra "đang/đã từng ghép"). Không có → `null`.
   */
  findLatestBetween(tx: Tx, userA: string, userB: string): Promise<Match | null>;
}
