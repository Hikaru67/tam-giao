import { OutboxWriter, type EventBus } from '@tamgiao/db';
import type { AppEnv, RequireAdmin } from '@tamgiao/http';
import type { Clock, Scheduler, UnitOfWork } from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { ProfileFacade } from '@tamgiao/module-profile/facade';
import type { VerificationFacade } from '@tamgiao/module-verification/facade';
import { Hono, type MiddlewareHandler } from 'hono';
import { SetCandidateVerification, SyncCandidateProfile } from './application/candidate-profile-sync.js';
import { FindCandidates } from './application/find-candidates.js';
import { MATCH_EXPIRY_QUEUE } from './application/match-expiry.js';
import { ProposeMatch } from './application/propose-match.js';
import { AcceptOffer } from './application/responses/accept-offer.js';
import { DeclineOffer } from './application/responses/decline-offer.js';
import { ExpireMatch } from './application/responses/expire-match.js';
import type { MatchResponseDeps } from './application/responses/respond-to-open-match.js';
import { WithdrawIntro } from './application/responses/withdraw-intro.js';
import { registerCandidateProfileConsumers } from './infrastructure/candidate-profile-consumers.js';
import { registerReportFiledConsumer } from './infrastructure/report-filed-consumer.js';
import { registerAccountDeletionConsumer } from './infrastructure/account-data.js';
import { registerDateCompletedConsumer } from './infrastructure/date-completed-consumer.js';
import { MarkMatchMet } from './application/responses/mark-match-met.js';
import { registerUserBannedConsumer } from './infrastructure/user-banned-consumer.js';
import { LockMatch } from './application/responses/lock-match.js';
import type { MatchingFacade } from './application/facade.js';
import { MatchPairLookup } from './application/match-pair-lookup.js';
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
import { createMatchAdminRoutes } from './presentation/match-admin-routes.js';
import { createMatchRoutes } from './presentation/match-routes.js';

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
  CANDIDATE_ON_PROFILE_UPDATED_CONSUMER,
} from './infrastructure/candidate-profile-consumers.js';

export { MATCH_LOCK_ON_REPORT_FILED_CONSUMER } from './infrastructure/report-filed-consumer.js';
export {
  MATCH_ERASE_ON_ACCOUNT_DELETION_CONSUMER,
  MATCH_LOCK_REASON_ACCOUNT_DELETED,
  createMatchingPersonalDataSource,
} from './infrastructure/account-data.js';
export {
  DATE_COMPLETED_EVENT,
  MATCH_MET_ON_DATE_COMPLETED_CONSUMER,
} from './infrastructure/date-completed-consumer.js';
export type {
  MarkMatchMet,
  MarkMatchMetCommand,
  MarkMatchMetOutcome,
} from './application/responses/mark-match-met.js';
export { MATCH_CLOSE_REASON_TIMEOUT } from './domain/match.js';
export {
  MATCH_EXCLUDE_ON_USER_BANNED_CONSUMER,
  MATCH_LOCK_REASON_USER_BANNED,
} from './infrastructure/user-banned-consumer.js';

export interface MatchingWorkerDeps {
  readonly clock: Clock;
  /** Facade profile (chỉ cần `getMatchingProfile`) — `createMatchingProfileReader` của module profile. */
  readonly profiles: Pick<ProfileFacade, 'getMatchingProfile'>;
  /**
   * Ghi job hẹn giờ cùng transaction (worker: `PgBossScheduler`) — hiệu ứng chuyển trạng thái dùng chung của
   * consumer khoá match (BE-S6-05; vào `LOCKED` không hẹn job nhưng port dùng chung với các use case khác).
   */
  readonly scheduler: Scheduler;
}

export interface MatchingWorker {
  /**
   * Đăng ký consumer của matching (worker gọi trước `registerConsumers`): read model `matching.candidate_profiles`
   * (BE-S5-03), `ReportFiled` → khoá match (BE-S6-05), `DateCompleted` → `MET` (BE-S7-04).
   */
  registerConsumers(bus: EventBus): void;
}

/** Phần worker của module matching: consumer read model ứng viên (BE-S5-03) + khoá match khi có báo cáo (BE-S6-05). */
export function createMatchingWorker(deps: MatchingWorkerDeps): MatchingWorker {
  const candidates = new DrizzleCandidateProfileRepository();
  const consumers = {
    syncProfile: new SyncCandidateProfile({ clock: deps.clock, profiles: deps.profiles, candidates }),
    setVerification: new SetCandidateVerification({ clock: deps.clock, candidates }),
  };
  const lockMatch = createLockMatch(deps);
  const markMatchMet = new MarkMatchMet({
    clock: deps.clock,
    scheduler: deps.scheduler,
    matches: new DrizzleMatchRepository(new OutboxWriter()),
    activeSlots: new DrizzleActiveSlotRepository(),
    pairHistory: new DrizzlePairHistoryRepository(),
    cooldowns: new DrizzleCooldownRepository(),
  });
  return {
    registerConsumers: (bus) => {
      registerCandidateProfileConsumers(bus, consumers);
      registerReportFiledConsumer(bus, lockMatch);
      // BE-S6-06: UserBanned (safety) → loại khỏi ứng viên + khoá match đang mở.
      registerUserBannedConsumer(bus, {
        setVerification: consumers.setVerification,
        matches: new DrizzleMatchRepository(new OutboxWriter()),
        lockMatch,
      });
      // BE-S7-06: AccountDeletionRequested (identity) → đóng match đang mở + xoá read model ứng viên.
      registerAccountDeletionConsumer(bus, {
        matches: new DrizzleMatchRepository(new OutboxWriter()),
        lockMatch,
      });
      // BE-S7-04: DateCompleted (dating) → match MET (bỏ hạn DATING_DAYS).
      registerDateCompletedConsumer(bus, markMatchMet);
    },
  };
}

// ── Khoá match khi có báo cáo vi phạm + facade cho safety (BE-S6-05) ───────────────────────────────────
export {
  MATCH_LOCK_REASON_REPORT_FILED,
  type LockMatch,
  type LockMatchCommand,
  type LockMatchOutcome,
} from './application/responses/lock-match.js';
export type {
  MatchBetweenSummary,
  MatchingFacade,
  MatchPairStatus,
  OpenMatchSummary,
} from './application/facade.js';

/** Use case khoá match (BE-S6-05) — consumer `ReportFiled` gọi `executeIn(tx, …)`. */
export function createLockMatch(deps: { readonly clock: Clock; readonly scheduler: Scheduler }): LockMatch {
  return new LockMatch({
    clock: deps.clock,
    scheduler: deps.scheduler,
    matches: new DrizzleMatchRepository(new OutboxWriter()),
    activeSlots: new DrizzleActiveSlotRepository(),
    pairHistory: new DrizzlePairHistoryRepository(),
    cooldowns: new DrizzleCooldownRepository(),
  });
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
  /** Guard người dùng app — `requireUser(identity.facade.authenticateUser)` (route `/me/match*`, BE-S5-07). */
  readonly requireUser: MiddlewareHandler<AppEnv>;
  /** Ghi job hẹn giờ cùng transaction (API: `PgBossScheduler`). */
  readonly scheduler: Scheduler;
  /** Facade profile — hồ sơ hiển thị + họ tên cho query màn ghép đôi (BE-S5-06). API truyền `profile.facade`. */
  readonly profiles: MatchDisplayDirectory;
}

export interface MatchingModule {
  readonly name: 'matching';
  /**
   * Route BE-S5-07: người dùng `GET /me/match`, `GET /me/match/profile`, `POST /me/match/accept|decline|withdraw`;
   * admin `GET /admin/users/:id/candidates`, `POST /admin/matches`, `GET /admin/matches`.
   */
  readonly routes: Hono<AppEnv>;
  readonly commands: {
    readonly proposeMatch: ProposeMatch;
    /** Phản hồi lời ngỏ của người dùng (BE-S5-05) — route `POST /me/match/accept|decline|withdraw` (BE-S5-07). */
    readonly acceptOffer: AcceptOffer;
    readonly declineOffer: DeclineOffer;
    readonly withdrawIntro: WithdrawIntro;
  };
  /** Query màn ghép đôi user + admin (BE-S5-06) — route ở BE-S5-07. */
  readonly queries: MatchingQueries;
  /** Facade read-only cho module khác (BE-S6-05: safety kiểm tra cặp đang/đã từng ghép). */
  readonly facade: MatchingFacade;
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
  const responseDeps = matchResponseDeps(deps);
  const commands = {
    proposeMatch,
    acceptOffer: new AcceptOffer(responseDeps),
    declineOffer: new DeclineOffer(responseDeps),
    withdrawIntro: new WithdrawIntro(responseDeps),
  };
  const queries = createMatchingQueries(deps);

  const routes = new Hono<AppEnv>();
  routes.route(
    '/',
    createMatchRoutes({
      getCurrentMatch: queries.getCurrentMatch,
      getMatchProfile: queries.getMatchProfile,
      acceptOffer: commands.acceptOffer,
      declineOffer: commands.declineOffer,
      withdrawIntro: commands.withdrawIntro,
      requireUser: deps.requireUser,
    }),
  );
  routes.route(
    '/',
    createMatchAdminRoutes({
      proposeMatch: commands.proposeMatch,
      listCandidates: queries.listCandidates,
      getMatchesBoard: queries.getMatchesBoard,
      requireAdmin: deps.requireAdmin,
    }),
  );

  const facade: MatchingFacade = new MatchPairLookup({
    uow: deps.uow,
    matches: new DrizzleMatchRepository(new OutboxWriter()),
  });

  return { name: 'matching', routes, commands, queries, facade };
}

// ── Đồng ý / Bỏ qua / Rút lời ngỏ / Hết hạn (BE-S5-05) ──────────────────────────────────────────────────
export type { AcceptOffer, AcceptOfferCommand } from './application/responses/accept-offer.js';
export type { DeclineOffer, DeclineOfferCommand } from './application/responses/decline-offer.js';
export type { WithdrawIntro, WithdrawIntroCommand } from './application/responses/withdraw-intro.js';
export type {
  MatchResponseView,
  RespondToMatchError,
} from './application/responses/respond-to-open-match.js';
export type { ExpireMatch, ExpireMatchOutcome } from './application/responses/expire-match.js';
export { MATCH_RESPONSE_ERROR_CODES } from './application/responses/response-errors.js';

function matchResponseDeps(deps: {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
}): MatchResponseDeps {
  return {
    uow: deps.uow,
    clock: deps.clock,
    scheduler: deps.scheduler,
    matches: new DrizzleMatchRepository(new OutboxWriter()),
    activeSlots: new DrizzleActiveSlotRepository(),
    pairHistory: new DrizzlePairHistoryRepository(),
    cooldowns: new DrizzleCooldownRepository(),
  };
}

/**
 * Handler job hết hạn match (`MATCH_EXPIRY_QUEUE`) cho worker — `apps/worker/src/jobs/match-expiry.ts` đăng ký bằng
 * `registerJob` và gọi `executeIn(tx, payload)`. `scheduler` theo port chung (job hết hạn hiện không hẹn job mới vì
 * `expire` chỉ đóng match, nhưng hiệu ứng chuyển trạng thái dùng chung với các use case khác).
 */
export function createExpireMatchJob(deps: {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
}): ExpireMatch {
  return new ExpireMatch(matchResponseDeps(deps));
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
