import { ok, type Result } from '@tamgiao/kernel';
import { CompatibilityScorer, type CommonPointCode } from '../../domain/compatibility-scorer.js';
import type { MatchId, OpenMatchStatus } from '../../domain/match.js';
import {
  isOpenStatus,
  phaseFor,
  toCounterpartSummary,
  toScoreView,
  type CounterpartSummaryView,
  type MatchScoreView,
  type UserMatchPhase,
} from './match-display-rules.js';
import { userCommonPoints, type MatchQueryDeps } from './match-query-support.js';

export interface CurrentMatchView {
  readonly matchId: MatchId;
  readonly status: OpenMatchStatus;
  readonly phase: UserMatchPhase;
  /** Hạn của trạng thái hiện tại, đúng giá trị `matching.matches.expires_at` (client đếm ngược). */
  readonly expiresAt: Date | null;
  readonly offeredAt: Date;
  readonly datingStartedAt: Date | null;
  readonly score: MatchScoreView | null;
  readonly commonPoints: readonly CommonPointCode[];
  /** Lời nhắn chuyên viên — query chỉ trả cho người trong cặp. */
  readonly staffNote: string | null;
  /** `null` khi hồ sơ đối phương không đọc được (chưa/không còn `COMPLETED`). */
  readonly counterpart: CounterpartSummaryView | null;
}

/**
 * "Gợi ý hiện tại / đang chờ / đang hẹn" của người dùng (màn 7, 9 — BE-S5-06). Không có match mở → `null` (không
 * lỗi). Dữ liệu match (trạng thái, `expiresAt`, điểm, lời nhắn) + điểm chung đọc trong một transaction; hồ sơ hiển thị
 * đối phương đọc sau qua facade profile (transaction riêng, chỉ phần công khai + ảnh đại diện).
 */
export class GetCurrentMatchForUser {
  private readonly scorer: CompatibilityScorer;

  constructor(private readonly deps: MatchQueryDeps) {
    this.scorer = deps.scorer ?? new CompatibilityScorer();
  }

  async execute(query: { readonly userId: string }): Promise<Result<CurrentMatchView | null, never>> {
    const now = this.deps.clock.now();
    const viewer = query.userId.toLowerCase();
    const loaded = await this.deps.uow.run(async (tx) => {
      const match = await this.deps.matches.findOpenByUser(tx, viewer);
      if (match === null) return ok(null);
      const commonPoints = await userCommonPoints(this.deps.candidates, this.scorer, tx, match, now);
      return ok({ match, commonPoints });
    });
    if (loaded.isErr() || loaded.value === null) return ok(null);

    const { match, commonPoints } = loaded.value;
    const state = match.toState();
    const phase = phaseFor(state, viewer);
    const counterpartId = match.counterpartOf(viewer);
    // `findOpenByUser` chỉ trả match mở có người xem → luôn có phase / đối phương; khác là lỗi lập trình.
    if (phase === null || counterpartId === null || !isOpenStatus(state.status)) {
      throw new Error(`match ${match.id}: findOpenByUser trả match không hợp lệ cho người xem`);
    }

    const [profile] = await this.deps.profiles.getMatchDisplayProfiles([counterpartId], {
      photos: 'primary',
    });
    return ok({
      matchId: match.id,
      status: state.status,
      phase,
      expiresAt: state.expiresAt,
      offeredAt: state.offeredAt,
      datingStartedAt: state.datingStartedAt,
      score: toScoreView(state.scoreSnapshot),
      commonPoints,
      staffNote: state.staffNote,
      counterpart: profile ? toCounterpartSummary(profile, now) : null,
    });
  }
}
