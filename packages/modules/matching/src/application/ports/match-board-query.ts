import type { Tx } from '@tamgiao/kernel';
import type { MatchScoreSnapshot, MatchStatus, MatchUserId } from '../../domain/match.js';

/** Một dòng bảng theo dõi cặp của chuyên viên (BE-S5-06) — dữ liệu đọc, không dựng aggregate. */
export interface MatchBoardRow {
  readonly id: string;
  readonly participants: readonly [MatchUserId, MatchUserId];
  readonly status: MatchStatus;
  readonly acceptedBy: readonly MatchUserId[];
  readonly scoreSnapshot: MatchScoreSnapshot | null;
  readonly expiresAt: Date | null;
  readonly offeredAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string;
}

/** Vị trí dòng cuối của trang trước theo thứ tự (`expiresAt` tăng dần, `null` cuối; `id` tăng dần). */
export interface MatchBoardCursor {
  readonly expiresAt: Date | null;
  readonly id: string;
}

export interface MatchBoardFilter {
  /** Khác rỗng. */
  readonly statuses: readonly MatchStatus[];
}

/** Truy vấn bảng theo dõi cặp (`matching.matches`) — port riêng cho phía đọc, chạy trong `tx` của caller (A5). */
export interface MatchBoardQuery {
  /**
   * Tối đa `limit` dòng có `status` thuộc bộ lọc, **sắp hết hạn trước**: `expires_at` tăng dần (`NULL` — `MET`,
   * trạng thái đóng — ở cuối), hoà → `id` tăng dần; chỉ các dòng đứng sau `cursor` (nếu có).
   */
  list(
    tx: Tx,
    filter: MatchBoardFilter,
    cursor: MatchBoardCursor | null,
    limit: number,
  ): Promise<readonly MatchBoardRow[]>;
}
