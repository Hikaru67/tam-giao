import { CHECK_IN_LOCATION_RETENTION_HOURS } from '@tamgiao/contracts/constants';
import {
  addDuration,
  err,
  fail,
  newId,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type Scheduler,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { DatePlanId } from '../domain/date-plan.js';
import { GeoPoint } from '../domain/geo-point.js';
import { SafetyCheckIn, type CheckOutError, type StartCheckInError } from '../domain/safety-check-in.js';
import { checkInLocationPurgeJob, checkInOverdueJob } from './check-in-jobs.js';
import type { DatePlanRepository } from './ports/date-plan-repository.js';
import type { CheckInLocationStore, SafetyCheckInRepository } from './ports/safety-check-in-repository.js';
import { toSafetyCheckInView, type SafetyCheckInView } from './safety-check-in-views.js';

type LookupError = DomainError<'INVALID_ID' | 'NOT_FOUND'>;

function parsePlanId(raw: string): Result<DatePlanId, LookupError> {
  const id = parseId<'DatePlan'>(raw);
  return id.isErr() ? fail('INVALID_ID', { field: 'datePlanId' }) : ok(id.value);
}

export interface CheckInLocationInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters?: number;
}

export interface CheckInToDateCommand {
  readonly userId: string;
  readonly datePlanId: string;
  /** Vị trí thô tuỳ chọn ("gửi vị trí cho chuyên viên"). */
  readonly location?: CheckInLocationInput;
}

export interface CheckInToDateDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly datePlans: DatePlanRepository;
  readonly checkIns: SafetyCheckInRepository;
  readonly locations: CheckInLocationStore;
}

export type CheckInToDateError = StartCheckInError | LookupError | DomainError<'VALIDATION_FAILED'>;

/**
 * Bật "Check-in an toàn" (BE-S7-02, `POST /me/dates/:id/check-in`). Vị trí sai dạng → `VALIDATION_FAILED`; rồi **một
 * transaction**: khoá lịch `FOR UPDATE` (tuần tự hoá với bên kia, consumer voucher, huỷ) → không có → `NOT_FOUND` →
 * domain `SafetyCheckIn.start` (người ngoài cặp → `NOT_PARTICIPANT`, lịch không `CONFIRMED | CHECKED_IN` →
 * `DATE_INVALID_TRANSITION`, ngoài khung giờ hẹn → `DATE_CHECK_IN_WINDOW_CLOSED`, đã check-in →
 * `DATE_ALREADY_CHECKED_IN`) → lưu lịch (người đầu tiên: `CHECKED_IN`) + check-in → vị trí (mã hoá, chỉ nhận được vì
 * check-in đã nằm trong khung giờ hẹn) + job xoá lúc `now + CHECK_IN_LOCATION_RETENTION_HOURS` → job quá hạn lúc
 * `overdueAt`. Job ghi cùng transaction.
 */
export class CheckInToDate {
  constructor(private readonly deps: CheckInToDateDeps) {}

  async execute(cmd: CheckInToDateCommand): Promise<Result<SafetyCheckInView, CheckInToDateError>> {
    const id = parsePlanId(cmd.datePlanId);
    if (id.isErr()) return err(id.error);
    let location: GeoPoint | null = null;
    if (cmd.location !== undefined) {
      const point = GeoPoint.create(cmd.location);
      if (point.isErr()) return err(point.error);
      location = point.value;
    }

    const { uow, clock, datePlans, checkIns } = this.deps;
    return uow.run(async (tx): Promise<Result<SafetyCheckInView, CheckInToDateError>> => {
      const plan = await datePlans.findByIdForUpdate(tx, id.value);
      if (plan === null) return fail('NOT_FOUND');
      const now = clock.now();
      const existing = plan.isParticipant(cmd.userId)
        ? await checkIns.findByPlanAndUser(tx, plan.id, cmd.userId)
        : null;
      const started = SafetyCheckIn.start(
        {
          id: newId<'SafetyCheckIn'>(),
          plan,
          existing,
          userId: cmd.userId,
          source: 'MANUAL',
          locationShared: location !== null,
        },
        now,
      );
      if (started.isErr()) return err(started.error);
      const checkIn = started.value;

      const savedPlan = await datePlans.save(tx, plan);
      if (savedPlan.isErr()) throw new Error(`dating.date_plans ${plan.id}: ${savedPlan.error.code} khi check-in`);
      const saved = await checkIns.save(tx, checkIn);
      if (saved.isErr()) return err(saved.error);

      if (location !== null) {
        const purgeAfter = addDuration(now, { hours: CHECK_IN_LOCATION_RETENTION_HOURS });
        await this.deps.locations.record(tx, { checkInId: checkIn.id, location, recordedAt: now, purgeAfter });
        await this.deps.scheduler.schedule(tx, checkInLocationPurgeJob(checkIn, purgeAfter));
      }
      await this.deps.scheduler.schedule(tx, checkInOverdueJob(checkIn));
      return ok(toSafetyCheckInView(checkIn));
    });
  }
}

export interface CheckOutOfDateCommand {
  readonly userId: string;
  readonly datePlanId: string;
}

export interface CheckOutOfDateDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly datePlans: DatePlanRepository;
  readonly checkIns: SafetyCheckInRepository;
}

export type CheckOutOfDateError = CheckOutError | LookupError | DomainError<'NOT_PARTICIPANT'>;

/**
 * Check-out (BE-S7-02, `POST /me/dates/:id/check-out`). Một transaction: lịch không có → `NOT_FOUND` → người ngoài cặp
 * → `NOT_PARTICIPANT` → khoá check-in của người dùng `FOR UPDATE` (tuần tự hoá với job quá hạn) → chưa check-in →
 * `DATE_NOT_CHECKED_IN` (`reason: NOT_CHECKED_IN`) → domain (đã check-out → `reason: ALREADY_CHECKED_OUT`). Được
 * check-out bất kỳ lúc nào sau check-in, kể cả sau cảnh báo quá hạn.
 */
export class CheckOutOfDate {
  constructor(private readonly deps: CheckOutOfDateDeps) {}

  async execute(cmd: CheckOutOfDateCommand): Promise<Result<SafetyCheckInView, CheckOutOfDateError>> {
    const id = parsePlanId(cmd.datePlanId);
    if (id.isErr()) return err(id.error);
    const { uow, clock, datePlans, checkIns } = this.deps;
    return uow.run(async (tx): Promise<Result<SafetyCheckInView, CheckOutOfDateError>> => {
      const plan = await datePlans.findById(tx, id.value);
      if (plan === null) return fail('NOT_FOUND');
      if (!plan.isParticipant(cmd.userId)) return fail('NOT_PARTICIPANT');
      const checkIn = await checkIns.findByPlanAndUserForUpdate(tx, plan.id, cmd.userId);
      if (checkIn === null) return fail('DATE_NOT_CHECKED_IN', { reason: 'NOT_CHECKED_IN' });
      const out = checkIn.checkOut(clock.now());
      if (out.isErr()) return err(out.error);
      const saved = await checkIns.save(tx, checkIn);
      if (saved.isErr()) throw new Error(`dating.safety_check_ins ${checkIn.id}: ${saved.error.code} khi check-out`);
      return ok(toSafetyCheckInView(checkIn));
    });
  }
}

export interface GetMyCheckInDeps {
  readonly uow: UnitOfWork;
  readonly datePlans: DatePlanRepository;
  readonly checkIns: SafetyCheckInRepository;
}

export type GetMyCheckInError = LookupError | DomainError<'NOT_PARTICIPANT'>;

/** `GET /me/dates/:id/check-in` — check-in an toàn của người xem cho lịch (`null` khi chưa check-in). */
export class GetMyCheckIn {
  constructor(private readonly deps: GetMyCheckInDeps) {}

  async execute(cmd: CheckOutOfDateCommand): Promise<Result<SafetyCheckInView | null, GetMyCheckInError>> {
    const id = parsePlanId(cmd.datePlanId);
    if (id.isErr()) return err(id.error);
    const { uow, datePlans, checkIns } = this.deps;
    return uow.run(async (tx): Promise<Result<SafetyCheckInView | null, GetMyCheckInError>> => {
      const plan = await datePlans.findById(tx, id.value);
      if (plan === null) return fail('NOT_FOUND');
      if (!plan.isParticipant(cmd.userId)) return fail('NOT_PARTICIPANT');
      const checkIn = await checkIns.findByPlanAndUser(tx, plan.id, cmd.userId);
      return ok(checkIn === null ? null : toSafetyCheckInView(checkIn));
    });
  }
}
