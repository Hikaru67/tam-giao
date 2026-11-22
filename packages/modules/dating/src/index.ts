import { OutboxWriter, type EventBus } from '@tamgiao/db';
import type { AppEnv, RequireAdmin } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Clock, Encryptor, Scheduler, UnitOfWork } from '@tamgiao/kernel';
import type { BillingPartnerFacade } from '@tamgiao/module-billing/facade';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { MatchingFacade } from '@tamgiao/module-matching/facade';
import {
  CheckInOnVoucherRedeemed,
  MarkCheckInOverdue,
  PurgeCheckInLocations,
} from './application/check-in-worker-jobs.js';
import { GetFeedbackDetail, ListAppearanceFlags } from './application/feedback-admin.js';
import { GetMyFeedback, SubmitFeedback } from './application/submit-feedback.js';
import { DrizzleFeedbackRepository } from './infrastructure/drizzle-feedback-repository.js';
import { createFeedbackAdminRoutes } from './presentation/feedback-admin-routes.js';
import { createFeedbackRoutes } from './presentation/feedback-routes.js';
import { ExpireDatePlan } from './application/expire-date-plan.js';
import { GetCurrentDatePlan } from './application/get-current-date-plan.js';
import { ProposeDate } from './application/propose-date.js';
import { CancelDate, ConfirmDate, DeclineDate } from './application/respond-to-date.js';
import { CheckInToDate, CheckOutOfDate, GetMyCheckIn } from './application/safety-check-in.js';
import { DrizzleCheckInLocationStore } from './infrastructure/drizzle-check-in-location-store.js';
import { DrizzleDatePlanRepository } from './infrastructure/drizzle-date-plan-repository.js';
import { DrizzleSafetyCheckInRepository } from './infrastructure/drizzle-safety-check-in-repository.js';
import { registerVoucherRedeemedConsumer } from './infrastructure/voucher-redeemed-consumer.js';
import { createCheckInRoutes } from './presentation/check-in-routes.js';
import { createDateRoutes } from './presentation/date-routes.js';

/**
 * Module dating (Sprint 7): đặt lịch gặp mặt tại quán đối tác (BE-S7-01), check-in an toàn (BE-S7-02).
 * Đánh giá sau gặp (BE-S7-03) bổ sung sau.
 */

export type { DatePlanId, DatePlanStatus } from './domain/date-plan.js';
export type { DatePlanView } from './application/date-plan-views.js';
export type { ProposeDate, ProposeDateCommand, ProposeDateError } from './application/propose-date.js';
export type { CancelDate, ConfirmDate, DatePlanCommand, DeclineDate } from './application/respond-to-date.js';
export type { ExpireDatePlan, ExpireDatePlanOutcome } from './application/expire-date-plan.js';
export {
  DATE_PLAN_EXPIRY_QUEUE,
  DATING_SCHEDULED_QUEUES,
  type DatePlanExpiryPayload,
} from './application/date-plan-expiry.js';

export type {
  CheckInLocationInput,
  CheckInToDate,
  CheckInToDateCommand,
  CheckInToDateError,
  CheckOutOfDate,
  CheckOutOfDateCommand,
  CheckOutOfDateError,
  GetMyCheckIn,
  GetMyCheckInError,
} from './application/safety-check-in.js';
export type { SafetyCheckInView } from './application/safety-check-in-views.js';
export type {
  CheckInOnVoucherRedeemedOutcome,
  MarkCheckInOverdue,
  MarkCheckInOverdueOutcome,
  PurgeCheckInLocations,
  PurgeCheckInLocationsOutcome,
} from './application/check-in-worker-jobs.js';
export {
  CHECK_IN_LOCATION_PURGE_QUEUE,
  CHECK_IN_OVERDUE_QUEUE,
  type CheckInOverduePayload,
} from './application/check-in-jobs.js';
export { CHECK_IN_ON_VOUCHER_REDEEMED_CONSUMER } from './infrastructure/voucher-redeemed-consumer.js';
// ── Đánh giá kín sau gặp (BE-S7-03) ─────────────────────────────────────────────────────────────────────
export type { DateFeedbackId, FeedbackAnswers, FeedbackOutcome } from './domain/date-feedback.js';
export type {
  FeedbackView,
  GetMyFeedback,
  SubmitFeedback,
  SubmitFeedbackCommand,
  SubmitFeedbackError,
} from './application/submit-feedback.js';
export {
  DATING_AUDIT_ACTION_VIEW_FEEDBACK,
  DATING_AUDIT_TARGET_FEEDBACK,
  type GetFeedbackDetail,
  type ListAppearanceFlags,
} from './application/feedback-admin.js';

export interface DatingModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  /** Ghi job hết hạn xác nhận cùng transaction (`PgBossScheduler` phía API). */
  readonly scheduler: Scheduler;
  /** Mã hoá vị trí check-in qua Encryptor (AGENTS.md mục 5). */
  readonly encryptor: Encryptor;
  /** Guard người dùng app — `requireUser(identity.facade.authenticateUser)`. */
  readonly requireUser: MiddlewareHandler<AppEnv>;
  /** Facade matching — match đang mở của người dùng (chỉ đặt hẹn khi `DATING`). */
  readonly matching: Pick<MatchingFacade, 'findOpenMatchForUser'>;
  /** Facade quán đối tác của billing — quán phải đang hoạt động. */
  readonly partners: Pick<BillingPartnerFacade, 'isActivePartner'>;
  /** Guard admin — hàng chờ cờ "khác biệt eKYC" + xem đánh giá kín (BE-S7-03, `kyc:review`). */
  readonly requireAdmin: RequireAdmin;
  /** Ghi audit khi chuyên viên xem đánh giá kín (BE-S7-03). */
  readonly auditLogger: AuditLogger;
}

export interface DatingModule {
  readonly name: 'dating';
  /**
   * `GET /me/dates/current`, `POST /me/dates`, `POST /me/dates/:id/confirm|decline|cancel|check-in|check-out`,
   * `GET /me/dates/:id/check-in`; đánh giá sau gặp `POST|GET /me/dates/:id/feedback`; admin
   * `GET /admin/dating/appearance-flags`, `GET /admin/dating/feedbacks/:id`.
   */
  readonly routes: Hono<AppEnv>;
  readonly commands: {
    readonly proposeDate: ProposeDate;
    readonly confirmDate: ConfirmDate;
    readonly declineDate: DeclineDate;
    readonly cancelDate: CancelDate;
    readonly checkInToDate: CheckInToDate;
    readonly checkOutOfDate: CheckOutOfDate;
    readonly submitFeedback: SubmitFeedback;
  };
}

/** Composition root phía API của module dating. */
export function createDatingModule(deps: DatingModuleDeps): DatingModule {
  const { uow, clock } = deps;
  const outbox = new OutboxWriter();
  const datePlans = new DrizzleDatePlanRepository(outbox);
  const checkIns = new DrizzleSafetyCheckInRepository(outbox);
  const locations = new DrizzleCheckInLocationStore(deps.encryptor);

  const proposeDate = new ProposeDate({
    uow,
    clock,
    scheduler: deps.scheduler,
    datePlans,
    matching: deps.matching,
    partners: deps.partners,
  });
  const confirmDate = new ConfirmDate({ uow, clock, datePlans, matching: deps.matching });
  const declineDate = new DeclineDate({ uow, clock, datePlans });
  const cancelDate = new CancelDate({ uow, clock, datePlans });

  const checkInToDate = new CheckInToDate({
    uow,
    clock,
    scheduler: deps.scheduler,
    datePlans,
    checkIns,
    locations,
  });
  const checkOutOfDate = new CheckOutOfDate({ uow, clock, datePlans, checkIns });
  const getMyCheckIn = new GetMyCheckIn({ uow, datePlans, checkIns });

  const dateRoutes = createDateRoutes({
    proposeDate,
    confirmDate,
    declineDate,
    cancelDate,
    getCurrentDatePlan: new GetCurrentDatePlan({ uow, datePlans, matching: deps.matching }),
    requireUser: deps.requireUser,
  });
  const checkInRoutes = createCheckInRoutes({
    checkInToDate,
    checkOutOfDate,
    getMyCheckIn,
    requireUser: deps.requireUser,
  });

  const routes = new Hono<AppEnv>();
  routes.route('/', dateRoutes);
  routes.route('/', checkInRoutes);

  // BE-S7-03: đánh giá kín sau gặp + hàng chờ cờ "khác biệt eKYC" cho chuyên viên.
  const feedbacks = new DrizzleFeedbackRepository(new OutboxWriter());
  const submitFeedback = new SubmitFeedback({ uow, clock, datePlans, feedbacks });
  routes.route(
    '/',
    createFeedbackRoutes({
      submitFeedback,
      getMyFeedback: new GetMyFeedback({ uow, datePlans, feedbacks }),
      requireUser: deps.requireUser,
    }),
  );
  routes.route(
    '/',
    createFeedbackAdminRoutes({
      listAppearanceFlags: new ListAppearanceFlags({ uow, feedbacks }),
      getFeedbackDetail: new GetFeedbackDetail({ uow, feedbacks, auditLogger: deps.auditLogger }),
      requireAdmin: deps.requireAdmin,
    }),
  );

  return {
    name: 'dating',
    routes,
    commands: {
      proposeDate,
      confirmDate,
      declineDate,
      cancelDate,
      checkInToDate,
      checkOutOfDate,
      submitFeedback,
    },
  };
}

/** Use case job hết hạn xác nhận lịch hẹn (BE-S7-01) cho worker — không cần nối route/facade. */
export function createExpireDatePlanJob(deps: {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
}): ExpireDatePlan {
  return new ExpireDatePlan({
    uow: deps.uow,
    clock: deps.clock,
    datePlans: new DrizzleDatePlanRepository(new OutboxWriter()),
  });
}

export interface DatingWorkerDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly encryptor: Encryptor;
}

export interface DatingWorker {
  registerConsumers(bus: EventBus): void;
  readonly markCheckInOverdue: MarkCheckInOverdue;
  readonly purgeCheckInLocations: PurgeCheckInLocations;
}

/** Worker của module dating (BE-S7-02): consumer voucher quét quán + jobs quá hạn check-in & xoá vị trí. */
export function createDatingWorker(deps: DatingWorkerDeps): DatingWorker {
  const outbox = new OutboxWriter();
  const datePlans = new DrizzleDatePlanRepository(outbox);
  const checkIns = new DrizzleSafetyCheckInRepository(outbox);
  const locations = new DrizzleCheckInLocationStore(deps.encryptor);

  const markCheckInOverdue = new MarkCheckInOverdue({
    uow: deps.uow,
    clock: deps.clock,
    checkIns,
  });
  const purgeCheckInLocations = new PurgeCheckInLocations({
    uow: deps.uow,
    clock: deps.clock,
    locations,
  });
  const checkInOnVoucherRedeemed = new CheckInOnVoucherRedeemed({
    scheduler: deps.scheduler,
    datePlans,
    checkIns,
  });

  return {
    registerConsumers(bus: EventBus): void {
      registerVoucherRedeemedConsumer(bus, checkInOnVoucherRedeemed);
    },
    markCheckInOverdue,
    purgeCheckInLocations,
  };
}
