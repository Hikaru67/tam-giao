import { OutboxWriter } from '@tamgiao/db';
import type { AppEnv } from '@tamgiao/http';
import type { Clock, Scheduler, UnitOfWork } from '@tamgiao/kernel';
import type { BillingPartnerFacade } from '@tamgiao/module-billing/facade';
import type { MatchingFacade } from '@tamgiao/module-matching/facade';
import type { Hono, MiddlewareHandler } from 'hono';
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
}

export interface DatingModule {
  readonly name: 'dating';
  /** `GET /me/dates/current`, `POST /me/dates`, `POST /me/dates/:id/confirm|decline|cancel`. */
  readonly routes: Hono<AppEnv>;
  readonly commands: {
    readonly proposeDate: ProposeDate;
    readonly confirmDate: ConfirmDate;
    readonly declineDate: DeclineDate;
    readonly cancelDate: CancelDate;
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
  const routes = createDateRoutes({
    proposeDate,
    confirmDate,
    declineDate,
    cancelDate,
    getCurrentDatePlan: new GetCurrentDatePlan({ uow, datePlans, matching: deps.matching }),
    requireUser: deps.requireUser,
  });
  return { name: 'dating', routes, commands: { proposeDate, confirmDate, declineDate, cancelDate } };
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
