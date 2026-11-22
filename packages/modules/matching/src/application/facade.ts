/**
 * Facade read-only của module matching cho module khác (AGENTS.md A3). Chỉ chứa kiểu + thao tác chỉ-đọc; module khác
 * (safety…) không đọc bảng `matching.*`. Mỗi lời gọi tự mở transaction ngắn.
 */

/** Trạng thái match (khớp `MATCH_STATUSES` của domain matching — có test đối chiếu). */
export type MatchPairStatus =
  | 'OFFERED'
  | 'AWAITING_RESPONSE'
  | 'DATING'
  | 'MET'
  | 'CLOSED_SUCCESS'
  | 'CLOSED_STOPPED'
  | 'EXPIRED'
  | 'DECLINED'
  | 'LOCKED';

/** Match gần nhất giữa hai người (BE-S6-05). */
export interface MatchBetweenSummary {
  readonly matchId: string;
  readonly status: MatchPairStatus;
  /** `true` khi match còn mở (`OFFERED | AWAITING_RESPONSE | DATING | MET`). */
  readonly isOpen: boolean;
}

/** Match đang mở của một người (BE-S7-01 — dating kiểm tra "chỉ đặt hẹn khi `DATING`"). */
export interface OpenMatchSummary {
  readonly matchId: string;
  /** Một trong `OFFERED | AWAITING_RESPONSE | DATING | MET`. */
  readonly status: MatchPairStatus;
  /** Hai người của cặp (giữ thứ tự lúc đề xuất). */
  readonly participantIds: readonly [string, string];
}

export interface MatchingFacade {
  /**
   * Match đang mở của `userId` (độc quyền 1-1 → tối đa một). Không có (hoặc id không hợp lệ) → `null`. Đọc nguồn chân
   * lý `matching.matches` trong một transaction ngắn (không khoá).
   */
  findOpenMatchForUser(userId: string): Promise<OpenMatchSummary | null>;

  /**
   * Match gần nhất (mới đề xuất nhất) giữa `userA` và `userB`, bất kể trạng thái — tức hai người "đang hoặc đã từng
   * được ghép". Chưa từng được đề xuất cho nhau (hoặc `userA === userB`, id không hợp lệ) → `null`.
   */
  findLatestMatchBetween(userA: string, userB: string): Promise<MatchBetweenSummary | null>;
}
