import type { Clock, Tx, UnitOfWork } from '@tamgiao/kernel';
import type { ProfileFacade } from '@tamgiao/module-profile/facade';
import type { CommonPointCode, CompatibilityScorer } from '../../domain/compatibility-scorer.js';
import type { Match } from '../../domain/match.js';
import type { CandidateProfileReader } from '../ports/candidate-profile-reader.js';
import type { MatchRepository } from '../ports/match-repository.js';
import { userFacingCommonPoints } from './match-display-rules.js';

/**
 * Phần facade profile mà query matching cần (BE-S5-06): hồ sơ hiển thị (phần công khai + ảnh) và tóm tắt họ tên cho
 * bảng admin. Composition root truyền `profile.facade`.
 */
export type MatchDisplayDirectory = Pick<ProfileFacade, 'getMatchDisplayProfiles' | 'getApplicantSummaries'>;

/** Phụ thuộc chung của query phía người dùng (`GetCurrentMatchForUser`, `GetMatchProfile`). */
export interface MatchQueryDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly matches: MatchRepository;
  readonly candidates: CandidateProfileReader;
  readonly profiles: Pick<MatchDisplayDirectory, 'getMatchDisplayProfiles'>;
  readonly scorer?: CompatibilityScorer;
}

/**
 * Điểm chung của cặp, **tính lại** bằng `CompatibilityScorer` trên read model `candidate_profiles` hiện tại (snapshot
 * lúc đề xuất chỉ lưu tổng + trụ cột, không lưu điểm chung). Một trong hai chưa có trong read model → rỗng. Đã lọc
 * theo luật hiển thị cho người dùng app (`userFacingCommonPoints`).
 */
export async function userCommonPoints(
  candidates: CandidateProfileReader,
  scorer: CompatibilityScorer,
  tx: Tx,
  match: Match,
  now: Date,
): Promise<readonly CommonPointCode[]> {
  const [a, b] = match.participants;
  const found = await candidates.findSynced(tx, [a, b]);
  const pa = found.get(a);
  const pb = found.get(b);
  if (pa === undefined || pb === undefined) return [];
  return userFacingCommonPoints(scorer.score(pa, pb, now).commonPoints);
}
