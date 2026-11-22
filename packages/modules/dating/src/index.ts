import { OutboxWriter } from '@tamgiao/db';
import type { AppEnv, RequireAdmin } from '@tamgiao/http';
import type { Clock, Scheduler, UnitOfWork } from '@tamgiao/kernel';
import type { BillingPartnerFacade } from '@tamgiao/module-billing/facade';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { MatchingFacade } from '@tamgiao/module-matching/facade';
import { Hono, type MiddlewareHandler } from 'hono';
import { GetFeedbackDetail, ListAppearanceFlags } from './application/feedback-admin.js';
import { GetMyFeedback, SubmitFeedback } from './application/submit-feedback.js';
import { DrizzleFeedbackRepository } from './infrastructure/drizzle-feedback-repository.js';
import { createFeedbackAdminRoutes } from './presentation/feedback-admin-routes.js';
import { createFeedbackRoutes } from './presentation/feedback-routes.js';
import { ExpireDatePlan } from './application/expire-date-plan.js';
import { GetCurrentDatePlan } from './application/get-current-date-plan.js';
import { ProposeDate } from './application/propose-date.js';
import { CancelDate, ConfirmDate, DeclineDate } from './application/respond-to-date.js';
import { DrizzleDatePlanRepository } from './infrastructure/drizzle-date-plan-repository.js';
import { createDateRoutes } from './presentation/date-routes.js';

/**
 * Module dating (Sprint 7): đặt lịch gặp mặt tại quán đối tác (BE-S7-01). Check-in an toàn (BE-S7-02) và đánh giá sau
 * gặp (BE-S7-03) bổ sung sau.
 */

export type { DatePlanId, DatePlanStatus } from './domain/date-plan.js';
export type { DatePlanView } from './application/date-plan-views.js';
export type { ProposeDate, ProposeDateCommand, ProposeDateError } from './application/propose-date.js';
export type {
  CancelDate,
  ConfirmDate,
  DatePlanCommand,
  DeclineDate,
} from './application/respond-to-date.js';
export type { ExpireDatePlan, ExpireDatePlanOutcome } from './application/expire-date-plan.js';
export {
  DATE_PLAN_EXPIRY_QUEUE,
  DATING_SCHEDULED_QUEUES,
  type DatePlanExpiryPayload,
} from './application/date-plan-expiry.js';

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
   * `GET /me/dates/current`, `POST /me/dates`, `POST /me/dates/:id/confirm|decline|cancel`; đánh giá sau gặp
   * `POST|GET /me/dates/:id/feedback`; admin `GET /admin/dating/appearance-flags`, `GET /admin/dating/feedbacks/:id`.
   */
  readonly routes: Hono<AppEnv>;
  readonly commands: {
    readonly proposeDate: ProposeDate;
    readonly confirmDate: ConfirmDate;
    readonly declineDate: DeclineDate;
    readonly cancelDate: CancelDate;
    readonly submitFeedback: SubmitFeedback;
  };
}

/** Composition root phía API của module dating. */
export function createDatingModule(deps: DatingModuleDeps): DatingModule {
  const { uow, clock } = deps;
  const datePlans = new DrizzleDatePlanRepository(new OutboxWriter());
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
  const routes = new Hono<AppEnv>();
  routes.route(
    '/',
    createDateRoutes({
      proposeDate,
      confirmDate,
      declineDate,
      cancelDate,
      getCurrentDatePlan: new GetCurrentDatePlan({ uow, datePlans, matching: deps.matching }),
      requireUser: deps.requireUser,
    }),
  );

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
    commands: { proposeDate, confirmDate, declineDate, cancelDate, submitFeedback },
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
