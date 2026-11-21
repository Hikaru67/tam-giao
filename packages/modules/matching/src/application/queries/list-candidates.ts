import { err, fail, ok, parseId, type Clock, type DomainError, type Result } from '@tamgiao/kernel';
import type { DisplayPhoto, MatchDisplayProfile } from '@tamgiao/module-profile/facade';
import type { CandidateError } from '../../domain/candidate-errors.js';
import { ageAt } from '../../domain/candidate-profile.js';
import type { CommonPointCode } from '../../domain/compatibility-scorer.js';
import type { FindCandidates } from '../find-candidates.js';
import type { MatchScoreView } from './match-display-rules.js';
import type { MatchDisplayDirectory } from './match-query-support.js';

/** Mặc định số ứng viên trả cho chuyên viên (tối đa `MAX_CANDIDATES` = 50, do `FindCandidates` chặn). */
export const CANDIDATE_LIST_DEFAULT = 20;

/** Hồ sơ hiển thị cho chuyên viên — họ tên đầy đủ (như màn duyệt eKYC), không có trường riêng tư mã hoá. */
export interface AdminCandidateProfileView {
  readonly fullName: string;
  readonly age: number;
  readonly gender: MatchDisplayProfile['gender'];
  readonly currentCity: string;
  readonly occupation: string;
  readonly education: MatchDisplayProfile['education'];
  readonly avatar: DisplayPhoto | null;
}

export interface AdminCandidateView {
  readonly userId: string;
  readonly score: MatchScoreView;
  /** Đủ mọi mã (kể cả `SAME_RELIGION`) — chuyên viên được xem. */
  readonly commonPoints: readonly CommonPointCode[];
  /** `null` khi hồ sơ không đọc được qua facade (đồng bộ read model trễ hơn hồ sơ). */
  readonly profile: AdminCandidateProfileView | null;
}

export type ListCandidatesError = CandidateError | DomainError<'INVALID_ID'>;

/**
 * Admin "Đề xuất mai mối" (BE-S5-06): top N ứng viên cho một người — `FindCandidates` (lọc cứng + chấm điểm, BE-S5-03)
 * rồi ghép hồ sơ hiển thị qua facade profile (họ tên, tuổi, thành phố, nghề, học vấn, ảnh đại diện).
 */
export class ListCandidates {
  constructor(
    private readonly deps: {
      readonly clock: Clock;
      readonly findCandidates: Pick<FindCandidates, 'execute'>;
      readonly profiles: Pick<MatchDisplayDirectory, 'getMatchDisplayProfiles'>;
    },
  ) {}

  async execute(query: {
    readonly userId: string;
    readonly limit?: number;
  }): Promise<Result<readonly AdminCandidateView[], ListCandidatesError>> {
    const userId = parseId<'User'>(query.userId);
    if (userId.isErr()) return fail('INVALID_ID');
    const ranked = await this.deps.findCandidates.execute({
      userId: userId.value,
      limit: query.limit ?? CANDIDATE_LIST_DEFAULT,
    });
    if (ranked.isErr()) return err(ranked.error);

    const now = this.deps.clock.now();
    const profiles = new Map(
      (
        await this.deps.profiles.getMatchDisplayProfiles(
          ranked.value.map((c) => c.profile.userId),
          { photos: 'primary' },
        )
      ).map((p) => [p.userId, p]),
    );
    return ok(
      ranked.value.map(({ profile: candidate, score }): AdminCandidateView => {
        const p = profiles.get(candidate.userId);
        return {
          userId: candidate.userId,
          score: { total: score.total, pillars: { ...score.pillars } },
          commonPoints: [...score.commonPoints],
          profile: p
            ? {
                fullName: p.fullName,
                age: ageAt(p.birthDate, now),
                gender: p.gender,
                currentCity: p.currentCity,
                occupation: p.occupation,
                education: p.education,
                avatar: p.photos[0] ?? null,
              }
            : null,
        };
      }),
    );
  }
}
