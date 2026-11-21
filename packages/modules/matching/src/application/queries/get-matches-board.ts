import { ok, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { OPEN_MATCH_STATUSES, type MatchStatus, type MatchUserId } from '../../domain/match.js';
import type { MatchBoardCursor, MatchBoardQuery } from '../ports/match-board-query.js';
import { toScoreView, type MatchScoreView } from './match-display-rules.js';
import type { MatchDisplayDirectory } from './match-query-support.js';

export const MATCHES_BOARD_PAGE_DEFAULT = 20;
export const MATCHES_BOARD_PAGE_MAX = 100;
/** Bảng theo dõi mặc định: các cặp còn mở. */
export const MATCHES_BOARD_DEFAULT_STATUSES: readonly MatchStatus[] = OPEN_MATCH_STATUSES;

export interface MatchesBoardQueryInput {
  /** Bỏ trống = `MATCHES_BOARD_DEFAULT_STATUSES`. */
  readonly statuses?: readonly MatchStatus[];
  readonly cursor: MatchBoardCursor | null;
  readonly limit?: number;
}

export interface MatchesBoardParticipantView {
  readonly userId: MatchUserId;
  /** Họ tên qua facade profile; `null` khi chưa có hồ sơ. */
  readonly fullName: string | null;
  readonly accepted: boolean;
}

export interface MatchesBoardItemView {
  readonly matchId: string;
  readonly status: MatchStatus;
  readonly participants: readonly [MatchesBoardParticipantView, MatchesBoardParticipantView];
  readonly score: MatchScoreView | null;
  readonly expiresAt: Date | null;
  readonly offeredAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string;
}

export interface MatchesBoardPage {
  readonly items: readonly MatchesBoardItemView[];
  /** `null` khi hết dữ liệu. */
  readonly nextCursor: MatchBoardCursor | null;
}

/**
 * Admin "Bảng theo dõi cặp" (BE-S5-06): lọc trạng thái (mặc định trạng thái mở), **sắp hết hạn trước**, phân trang
 * cursor; tên hai người qua facade profile (`getApplicantSummaries`, như hàng chờ eKYC). Không trả lời nhắn chuyên viên
 * / lý do từ chối (có thể chứa PII) — không cần cho bảng.
 */
export class GetMatchesBoard {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly board: MatchBoardQuery;
      readonly profiles: Pick<MatchDisplayDirectory, 'getApplicantSummaries'>;
    },
  ) {}

  async execute(query: MatchesBoardQueryInput): Promise<Result<MatchesBoardPage, never>> {
    const limit = Math.min(Math.max(query.limit ?? MATCHES_BOARD_PAGE_DEFAULT, 1), MATCHES_BOARD_PAGE_MAX);
    const statuses = query.statuses?.length ? [...new Set(query.statuses)] : MATCHES_BOARD_DEFAULT_STATUSES;
    // Lấy dư 1 dòng để biết còn trang sau hay không.
    const found = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.board.list(tx, { statuses }, query.cursor, limit + 1)),
    );
    const rows = found.isOk() ? found.value : [];
    const page = rows.slice(0, limit);

    const names = new Map(
      (await this.deps.profiles.getApplicantSummaries([...new Set(page.flatMap((r) => r.participants))])).map(
        (s) => [s.userId, s.fullName],
      ),
    );
    const participant = (userId: MatchUserId, acceptedBy: readonly MatchUserId[]) => ({
      userId,
      fullName: names.get(userId) ?? null,
      accepted: acceptedBy.includes(userId),
    });
    const items = page.map((r): MatchesBoardItemView => ({
      matchId: r.id,
      status: r.status,
      participants: [
        participant(r.participants[0], r.acceptedBy),
        participant(r.participants[1], r.acceptedBy),
      ],
      score: toScoreView(r.scoreSnapshot),
      expiresAt: r.expiresAt,
      offeredAt: r.offeredAt,
      updatedAt: r.updatedAt,
      createdBy: r.createdBy,
    }));
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last !== undefined ? { expiresAt: last.expiresAt, id: last.id } : null;
    return ok({ items, nextCursor });
  }
}
