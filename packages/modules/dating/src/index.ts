import { OutboxWriter, type EventBus } from '@tamgiao/db';
import type { AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Clock, Encryptor, Scheduler, UnitOfWork } from '@tamgiao/kernel';
import type { BillingPartnerFacade } from '@tamgiao/module-billing/facade';
import type { MatchingFacade } from '@tamgiao/module-matching/facade';
import {
  CheckInOnVoucherRedeemed,
  MarkCheckInOverdue,
  PurgeCheckInLocations,
} from './application/check-in-worker-jobs.js';
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
}

export interface DatingModule {
  readonly name: 'dating';
  /** `GET /me/dates/current`, `POST /me/dates`, `POST /me/dates/:id/confirm|decline|cancel|check-in|check-out`, `GET /me/dates/:id/check-in`. */
  readonly routes: Hono<AppEnv>;
  readonly commands: {
    readonly proposeDate: ProposeDate;
    readonly confirmDate: ConfirmDate;
    readonly declineDate: DeclineDate;
    readonly cancelDate: CancelDate;
    readonly checkInToDate: CheckInToDate;
    readonly checkOutOfDate: CheckOutOfDate;
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

  return {
    name: 'dating',
    routes,
    commands: { proposeDate, confirmDate, declineDate, cancelDate, checkInToDate, checkOutOfDate },
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
