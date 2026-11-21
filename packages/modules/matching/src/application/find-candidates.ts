import { fail, ok, type Clock, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { CandidateError } from '../domain/candidate-errors.js';
import type { CandidateProfile } from '../domain/candidate-profile.js';
import { CompatibilityScorer, type CompatibilityScore } from '../domain/compatibility-scorer.js';
import type { CandidateFinder } from './ports/candidate-finder.js';

/** Số ứng viên tối đa trả về một lần (top N cho chuyên viên). */
export const MAX_CANDIDATES = 50;
/**
 * Số ứng viên qua bộ lọc cứng tối đa được nạp để chấm điểm trong một lần tìm. Chấm điểm chạy ở application nên
 * cần giới hạn tải; khi vượt, top N chỉ xét trong nhóm này (theo thứ tự ổn định của `CandidateFinder`).
 */
export const CANDIDATE_POOL_SIZE = 500;

export interface RankedCandidate {
  readonly profile: CandidateProfile;
  readonly score: CompatibilityScore;
}

/**
 * Top N ứng viên cho một người dùng (BE-S5-03): `CandidateFinder` lọc cứng hai chiều, rồi chấm điểm
 * `CompatibilityScorer` và sắp điểm giảm dần (hoà điểm → `userId` tăng dần, để kết quả ổn định).
 */
export class FindCandidates {
  private readonly scorer: CompatibilityScorer;

  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly clock: Clock;
      readonly finder: CandidateFinder;
      readonly scorer?: CompatibilityScorer;
    },
  ) {
    this.scorer = deps.scorer ?? new CompatibilityScorer();
  }

  async execute(cmd: {
    readonly userId: string;
    readonly limit: number;
  }): Promise<Result<readonly RankedCandidate[], CandidateError>> {
    const now = this.deps.clock.now();
    const limit = Math.max(1, Math.min(MAX_CANDIDATES, Math.trunc(cmd.limit)));
    return this.deps.uow.run(async (tx) => {
      const pool = await this.deps.finder.find(tx, cmd.userId, CANDIDATE_POOL_SIZE, now);
      if (pool === null) return fail('CANDIDATE_PROFILE_NOT_FOUND');
      const ranked = pool.candidates
        .map((profile) => ({ profile, score: this.scorer.score(pool.seeker, profile, now) }))
        .sort(
          (x, y) =>
            y.score.total - x.score.total ||
            (x.profile.userId < y.profile.userId ? -1 : x.profile.userId > y.profile.userId ? 1 : 0),
        );
      return ok(ranked.slice(0, limit));
    });
  }
}
