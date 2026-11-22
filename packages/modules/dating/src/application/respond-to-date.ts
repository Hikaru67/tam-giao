import {
  err,
  fail,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { MatchingFacade } from '@tamgiao/module-matching/facade';
import type { DateCancelError, DatePlan, DatePlanId, DateRespondError } from '../domain/date-plan.js';
import { toDatePlanView, type DatePlanView } from './date-plan-views.js';
import type { DatePlanRepository } from './ports/date-plan-repository.js';

export interface DatePlanCommand {
  readonly userId: string;
  readonly datePlanId: string;
}

type LookupError = DomainError<'INVALID_ID' | 'NOT_FOUND'>;

interface DatePlanActionDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly datePlans: DatePlanRepository;
}

function parsePlanId(raw: string): Result<DatePlanId, LookupError> {
  const id = parseId<'DatePlan'>(raw);
  return id.isErr() ? fail('INVALID_ID', { field: 'datePlanId' }) : ok(id.value);
}

/**
 * Khung chung cho thao tác của người dùng trên một lịch: **một transaction**, khoá lịch `FOR UPDATE` (tuần tự hoá với
 * bên kia và job hết hạn) → không có → `NOT_FOUND` → domain → lưu + event vào outbox.
 */
async function mutatePlan<E extends DomainError>(
  deps: DatePlanActionDeps,
  id: DatePlanId,
  apply: (plan: DatePlan, now: Date) => Result<void, E>,
): Promise<Result<DatePlanView, E | LookupError>> {
  return deps.uow.run(async (tx): Promise<Result<DatePlanView, E | LookupError>> => {
    const plan = await deps.datePlans.findByIdForUpdate(tx, id);
    if (plan === null) return fail('NOT_FOUND');
    const applied = apply(plan, deps.clock.now());
    if (applied.isErr()) return err(applied.error);
    const saved = await deps.datePlans.save(tx, plan);
    // Chỉ lịch mới mới có thể vi phạm unique "một lịch đang mở / match"; chuyển trạng thái không mở thêm lịch nào.
    if (saved.isErr()) throw new Error(`dating.date_plans ${plan.id}: ${saved.error.code} khi cập nhật`);
    return ok(toDatePlanView(plan));
  });
}

export interface ConfirmDateDeps extends DatePlanActionDeps {
  readonly matching: Pick<MatchingFacade, 'findOpenMatchForUser'>;
}

export type ConfirmDateError = DateRespondError | LookupError | DomainError<'MATCH_NOT_DATING'>;

/**
 * Người được mời xác nhận lịch (BE-S7-01, `POST /me/dates/:id/confirm`) → `CONFIRMED` + `DateConfirmed` (billing kích
 * hoạt voucher của người mời qua event). Đọc lịch (không khoá) để kiểm tra người ngoài cặp (`NOT_PARTICIPANT`, trước khi
 * lộ trạng thái match), rồi facade matching: match của lịch phải còn là match mở `DATING` của người dùng (không →
 * `MATCH_NOT_DATING`) — gọi ngoài transaction để không giữ hai connection; rồi transaction khoá lịch và để domain kiểm
 * tra lại toàn bộ luật (người mời → `DATE_NOT_INVITEE`, không còn `PROPOSED` → `DATE_INVALID_TRANSITION`, quá hạn →
 * `DATE_RESPONSE_EXPIRED`).
 */
export class ConfirmDate {
  constructor(private readonly deps: ConfirmDateDeps) {}

  async execute(cmd: DatePlanCommand): Promise<Result<DatePlanView, ConfirmDateError>> {
    const id = parsePlanId(cmd.datePlanId);
    if (id.isErr()) return err(id.error);
    const peek = await this.deps.uow.run(async (tx) => ok(await this.deps.datePlans.findById(tx, id.value)));
    const current = peek.unwrapOr(null);
    if (current === null) return fail('NOT_FOUND');
    if (!current.isParticipant(cmd.userId)) return fail('NOT_PARTICIPANT');

    const match = await this.deps.matching.findOpenMatchForUser(cmd.userId);
    if (match === null || match.matchId.toLowerCase() !== current.matchId || match.status !== 'DATING') {
      return fail('MATCH_NOT_DATING', {
        status: match !== null && match.matchId.toLowerCase() === current.matchId ? match.status : null,
      });
    }
    return mutatePlan(this.deps, id.value, (plan, now) => plan.confirm(cmd.userId, now));
  }
}

export type DeclineDateError = DateRespondError | LookupError;

/** Người được mời từ chối lịch (`POST /me/dates/:id/decline`) → `DECLINED` + `DateDeclined`; đề xuất lại được. */
export class DeclineDate {
  constructor(private readonly deps: DatePlanActionDeps) {}

  async execute(cmd: DatePlanCommand): Promise<Result<DatePlanView, DeclineDateError>> {
    const id = parsePlanId(cmd.datePlanId);
    if (id.isErr()) return err(id.error);
    return mutatePlan(this.deps, id.value, (plan, now) => plan.decline(cmd.userId, now));
  }
}

export type CancelDateError = DateCancelError | LookupError;

/**
 * Một trong hai người huỷ lịch đã xác nhận (`POST /me/dates/:id/cancel`) → `CANCELLED` + `DateCancelled`; chỉ khi còn
 * ≥ `DATE_CANCEL_CUTOFF_HOURS` giờ trước giờ bắt đầu (`CANCEL_TOO_LATE`). Voucher đã kích hoạt giữ nguyên.
 */
export class CancelDate {
  constructor(private readonly deps: DatePlanActionDeps) {}

  async execute(cmd: DatePlanCommand): Promise<Result<DatePlanView, CancelDateError>> {
    const id = parsePlanId(cmd.datePlanId);
    if (id.isErr()) return err(id.error);
    return mutatePlan(this.deps, id.value, (plan, now) => plan.cancel(cmd.userId, now));
  }
}
