import { err, fail, ok, parseId, type DomainError, type Result } from '@tamgiao/kernel';
import { CompatibilityScorer, type CommonPointCode } from '../../domain/compatibility-scorer.js';
import type { Match, MatchId, OpenMatchStatus } from '../../domain/match.js';
import {
  isOpenStatus,
  phaseFor,
  toCounterpartProfile,
  toScoreView,
  type CounterpartProfileView,
  type MatchScoreView,
  type UserMatchPhase,
} from './match-display-rules.js';
import { userCommonPoints, type MatchQueryDeps } from './match-query-support.js';

export interface MatchProfileView {
  readonly matchId: MatchId;
  readonly status: OpenMatchStatus;
  readonly phase: UserMatchPhase;
  readonly expiresAt: Date | null;
  readonly score: MatchScoreView | null;
  readonly commonPoints: readonly CommonPointCode[];
  readonly counterpart: CounterpartProfileView;
}

/**
 * - `INVALID_ID`: `matchId` không phải UUID.
 * - `NOT_FOUND`: không có match (theo id, hoặc không có match mở khi bỏ trống id), match đã đóng, hoặc hồ sơ đối
 *   phương không còn đọc được.
 * - `NOT_PARTICIPANT`: người xem không thuộc cặp (kiểm tra trước trạng thái — không lộ trạng thái cho người ngoài).
 */
export type GetMatchProfileError = DomainError<'INVALID_ID' | 'NOT_FOUND' | 'NOT_PARTICIPANT'>;

/**
 * Hồ sơ chi tiết đối phương (màn 8 — BE-S5-06): **chỉ người trong cặp**, chỉ khi match còn mở. Trả phần công khai của
 * hồ sơ (xem `toCounterpartProfile`); phần riêng tư chưa trả vì chưa có luật hiển thị (Blocker BE-S5-06).
 */
export class GetMatchProfile {
  private readonly scorer: CompatibilityScorer;

  constructor(private readonly deps: MatchQueryDeps) {
    this.scorer = deps.scorer ?? new CompatibilityScorer();
  }

  async execute(query: {
    readonly userId: string;
    /** Bỏ trống = match đang mở của người xem. */
    readonly matchId?: string;
  }): Promise<Result<MatchProfileView, GetMatchProfileError>> {
    const now = this.deps.clock.now();
    const viewer = query.userId.toLowerCase();
    let matchId: MatchId | null = null;
    if (query.matchId !== undefined) {
      const parsed = parseId<'Match'>(query.matchId);
      if (parsed.isErr()) return fail('INVALID_ID');
      matchId = parsed.value;
    }

    const loaded = await this.deps.uow.run(
      async (
        tx,
      ): Promise<
        Result<{ match: Match; commonPoints: readonly CommonPointCode[] }, GetMatchProfileError>
      > => {
        const match =
          matchId === null
            ? await this.deps.matches.findOpenByUser(tx, viewer)
            : await this.deps.matches.findById(tx, matchId);
        if (match === null) return fail('NOT_FOUND');
        if (!match.isParticipant(viewer)) return fail('NOT_PARTICIPANT');
        if (!match.isOpen()) return fail('NOT_FOUND');
        const commonPoints = await userCommonPoints(this.deps.candidates, this.scorer, tx, match, now);
        return ok({ match, commonPoints });
      },
    );
    if (loaded.isErr()) return err(loaded.error);

    const { match, commonPoints } = loaded.value;
    const state = match.toState();
    const phase = phaseFor(state, viewer);
    const counterpartId = match.counterpartOf(viewer);
    if (phase === null || counterpartId === null || !isOpenStatus(state.status)) {
      throw new Error(`match ${match.id}: trạng thái không hợp lệ sau khi đã kiểm tra mở + người trong cặp`);
    }

    const [profile] = await this.deps.profiles.getMatchDisplayProfiles([counterpartId], { photos: 'all' });
    if (profile === undefined) return fail('NOT_FOUND');
    return ok({
      matchId: match.id,
      status: state.status,
      phase,
      expiresAt: state.expiresAt,
      score: toScoreView(state.scoreSnapshot),
      commonPoints,
      counterpart: toCounterpartProfile(profile, now),
    });
  }
}
