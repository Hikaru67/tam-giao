import type { EventBus } from '@tamgiao/db';
import type { Clock, UnitOfWork } from '@tamgiao/kernel';
import type { ProfileFacade } from '@tamgiao/module-profile/facade';
import { SetCandidateVerification, SyncCandidateProfile } from './application/candidate-profile-sync.js';
import { FindCandidates } from './application/find-candidates.js';
import { registerCandidateProfileConsumers } from './infrastructure/candidate-profile-consumers.js';
import { DrizzleCandidateFinder } from './infrastructure/drizzle-candidate-finder.js';
import { DrizzleCandidateProfileRepository } from './infrastructure/drizzle-candidate-profile-repository.js';

/**
 * Module matching (Sprint 5): đề xuất ghép đôi, máy trạng thái `Match`, độc quyền 1-1, cooldown, chấm điểm tương hợp.
 * Composition root `createMatchingModule(deps)` được bổ sung dần theo task BE-S5-xx.
 */

// ── Chấm điểm tương hợp + tìm ứng viên (BE-S5-03) ──────────────────────────────────────────────────────
export type { CandidateProfile } from './domain/candidate-profile.js';
export type { CommonPointCode, CompatibilityScore } from './domain/compatibility-scorer.js';
export type { CompatibilityPillar } from './domain/compatibility-weights.js';
export type { CandidateError } from './domain/candidate-errors.js';
export type { FindCandidates, RankedCandidate } from './application/find-candidates.js';
export {
  CANDIDATE_ON_KYC_APPROVED_CONSUMER,
  CANDIDATE_ON_KYC_REJECTED_CONSUMER,
  CANDIDATE_ON_PREFERENCES_UPDATED_CONSUMER,
  CANDIDATE_ON_PROFILE_COMPLETED_CONSUMER,
} from './infrastructure/candidate-profile-consumers.js';

export interface MatchingWorkerDeps {
  readonly clock: Clock;
  /** Facade profile (chỉ cần `getMatchingProfile`) — `createMatchingProfileReader` của module profile. */
  readonly profiles: Pick<ProfileFacade, 'getMatchingProfile'>;
}

export interface MatchingWorker {
  /** Đăng ký consumer read model `matching.candidate_profiles` (worker gọi trước `registerConsumers`). */
  registerConsumers(bus: EventBus): void;
}

/** Phần worker của module matching: consumer đồng bộ read model ứng viên (BE-S5-03). */
export function createMatchingWorker(deps: MatchingWorkerDeps): MatchingWorker {
  const candidates = new DrizzleCandidateProfileRepository();
  const consumers = {
    syncProfile: new SyncCandidateProfile({ clock: deps.clock, profiles: deps.profiles, candidates }),
    setVerification: new SetCandidateVerification({ clock: deps.clock, candidates }),
  };
  return { registerConsumers: (bus) => registerCandidateProfileConsumers(bus, consumers) };
}

/** Use case top N ứng viên (BE-S5-03) — route admin `GET /admin/users/:id/candidates` (BE-S5-07) dùng lại. */
export function createFindCandidates(deps: {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
}): FindCandidates {
  return new FindCandidates({ uow: deps.uow, clock: deps.clock, finder: new DrizzleCandidateFinder() });
}
