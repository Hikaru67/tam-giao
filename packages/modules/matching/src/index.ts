import { OutboxWriter, type EventBus } from '@tamgiao/db';
import type { AppEnv, RequireAdmin } from '@tamgiao/http';
import type { Clock, Scheduler, UnitOfWork } from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { ProfileFacade } from '@tamgiao/module-profile/facade';
import type { VerificationFacade } from '@tamgiao/module-verification/facade';
import { Hono } from 'hono';
import { SetCandidateVerification, SyncCandidateProfile } from './application/candidate-profile-sync.js';
import { FindCandidates } from './application/find-candidates.js';
import { MATCH_EXPIRY_QUEUE } from './application/match-expiry.js';
import { ProposeMatch } from './application/propose-match.js';
import { registerCandidateProfileConsumers } from './infrastructure/candidate-profile-consumers.js';
import { DrizzleCandidateFinder } from './infrastructure/drizzle-candidate-finder.js';
import { DrizzleCandidateProfileRepository } from './infrastructure/drizzle-candidate-profile-repository.js';
import { DrizzleActiveSlotRepository } from './infrastructure/drizzle-active-slot-repository.js';
import { DrizzleCooldownRepository } from './infrastructure/drizzle-cooldown-repository.js';
import { DrizzleMatchRepository } from './infrastructure/drizzle-match-repository.js';
import { DrizzlePairHistoryRepository } from './infrastructure/drizzle-pair-history-repository.js';
import { GetCurrentMatchForUser } from './application/queries/get-current-match-for-user.js';
import { GetMatchProfile } from './application/queries/get-match-profile.js';
import { GetMatchesBoard } from './application/queries/get-matches-board.js';
import { ListCandidates } from './application/queries/list-candidates.js';
import type { MatchDisplayDirectory } from './application/queries/match-query-support.js';
import { DrizzleMatchBoardQuery } from './infrastructure/drizzle-match-queries.js';

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

// ── Đề xuất ghép đôi (BE-S5-04) ─────────────────────────────────────────────────────────────────────────
export { MATCH_EXPIRY_QUEUE };
export type { MatchExpiryPayload } from './application/match-expiry.js';
export {
  MATCH_AUDIT_TARGET_TYPE,
  MATCH_PROPOSE_AUDIT_ACTION,
  type ProposeMatch,
  type ProposeMatchCommand,
  type ProposeMatchError,
  type ProposedMatchView,
} from './application/propose-match.js';

/** Hàng đợi job mà API gửi trong transaction — composition root API tạo sẵn queue lúc khởi động. */
export const MATCHING_SCHEDULED_QUEUES = [MATCH_EXPIRY_QUEUE] as const;

export interface MatchingModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly verification: Pick<VerificationFacade, 'isVerified'>;
  readonly auditLogger: AuditLogger;
  /** Guard admin — route admin matching (BE-S5-07) dùng `requireAdmin('match:propose')`. */
  readonly requireAdmin: RequireAdmin;
  /** Ghi job hẹn giờ cùng transaction (API: `PgBossScheduler`). */
  readonly scheduler: Scheduler;
  /** Facade profile — hồ sơ hiển thị + họ tên cho query màn ghép đôi (BE-S5-06). API truyền `profile.facade`. */
  readonly profiles: MatchDisplayDirectory;
}

export interface MatchingModule {
  readonly name: 'matching';
  /** Chưa có route (route admin ở BE-S5-07). */
  readonly routes: Hono<AppEnv>;
  readonly commands: { readonly proposeMatch: ProposeMatch };
  /** Query màn ghép đôi user + admin (BE-S5-06) — route ở BE-S5-07. */
  readonly queries: MatchingQueries;
}

/** Composition root phía API của module matching. */
export function createMatchingModule(deps: MatchingModuleDeps): MatchingModule {
  const proposeMatch = new ProposeMatch({
    uow: deps.uow,
    clock: deps.clock,
    verification: deps.verification,
    profiles: new DrizzleCandidateProfileRepository(),
    cooldowns: new DrizzleCooldownRepository(),
    pairHistory: new DrizzlePairHistoryRepository(),
    activeSlots: new DrizzleActiveSlotRepository(),
    matches: new DrizzleMatchRepository(new OutboxWriter()),
    scheduler: deps.scheduler,
    auditLogger: deps.auditLogger,
  });
  return {
    name: 'matching',
    routes: new Hono<AppEnv>(),
    commands: { proposeMatch },
    queries: createMatchingQueries(deps),
  };
}

// ── Query màn hình user & admin (BE-S5-06) ──────────────────────────────────────────────────────────────
export {
  CANDIDATE_LIST_DEFAULT,
  type AdminCandidateProfileView,
  type AdminCandidateView,
  type ListCandidates,
  type ListCandidatesError,
} from './application/queries/list-candidates.js';
export type {
  CurrentMatchView,
  GetCurrentMatchForUser,
} from './application/queries/get-current-match-for-user.js';
export type {
  GetMatchProfile,
  GetMatchProfileError,
  MatchProfileView,
} from './application/queries/get-match-profile.js';
export {
  MATCHES_BOARD_DEFAULT_STATUSES,
  MATCHES_BOARD_PAGE_DEFAULT,
  MATCHES_BOARD_PAGE_MAX,
  type GetMatchesBoard,
  type MatchesBoardItemView,
  type MatchesBoardPage,
  type MatchesBoardParticipantView,
  type MatchesBoardQueryInput,
} from './application/queries/get-matches-board.js';
export {
  USER_MATCH_PHASES,
  type CounterpartProfileView,
  type CounterpartSummaryView,
  type MatchScoreView,
  type UserMatchPhase,
} from './application/queries/match-display-rules.js';
export type { MatchDisplayDirectory } from './application/queries/match-query-support.js';
export type { MatchBoardCursor } from './application/ports/match-board-query.js';

export interface MatchingQueries {
  /** `GET /me/match`. */
  readonly getCurrentMatch: GetCurrentMatchForUser;
  /** `GET /me/match/profile`. */
  readonly getMatchProfile: GetMatchProfile;
  /** `GET /admin/users/:id/candidates`. */
  readonly listCandidates: ListCandidates;
  /** `GET /admin/matches`. */
  readonly getMatchesBoard: GetMatchesBoard;
}

function createMatchingQueries(
  deps: Pick<MatchingModuleDeps, 'uow' | 'clock' | 'profiles'>,
): MatchingQueries {
  const userDeps = {
    uow: deps.uow,
    clock: deps.clock,
    matches: new DrizzleMatchRepository(new OutboxWriter()),
    candidates: new DrizzleCandidateProfileRepository(),
    profiles: deps.profiles,
  };
  return {
    getCurrentMatch: new GetCurrentMatchForUser(userDeps),
    getMatchProfile: new GetMatchProfile(userDeps),
    listCandidates: new ListCandidates({
      clock: deps.clock,
      findCandidates: createFindCandidates(deps),
      profiles: deps.profiles,
    }),
    getMatchesBoard: new GetMatchesBoard({
      uow: deps.uow,
      board: new DrizzleMatchBoardQuery(),
      profiles: deps.profiles,
    }),
  };
}
