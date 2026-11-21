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

export interface MatchingFacade {
  /**
   * Match gần nhất (mới đề xuất nhất) giữa `userA` và `userB`, bất kể trạng thái — tức hai người "đang hoặc đã từng
   * được ghép". Chưa từng được đề xuất cho nhau (hoặc `userA === userB`, id không hợp lệ) → `null`.
   */
  findLatestMatchBetween(userA: string, userB: string): Promise<MatchBetweenSummary | null>;
}
