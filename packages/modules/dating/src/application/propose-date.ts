import {
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
import type { BillingPartnerFacade } from '@tamgiao/module-billing/facade';
import type { MatchingFacade } from '@tamgiao/module-matching/facade';
import { DatePlan, type DateTimeInvalid } from '../domain/date-plan.js';
import { datePlanExpiryJob } from './date-plan-expiry.js';
import { toDatePlanView, type DatePlanView } from './date-plan-views.js';
import type { DatePlanRepository, DatePlanSaveError } from './ports/date-plan-repository.js';

export interface ProposeDateDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly datePlans: DatePlanRepository;
  readonly matching: Pick<MatchingFacade, 'findOpenMatchForUser'>;
  readonly partners: Pick<BillingPartnerFacade, 'isActivePartner'>;
}

export interface ProposeDateCommand {
  readonly userId: string;
  readonly partnerId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly staffBookingRequested: boolean;
}

export type ProposeDateError =
  DomainError<'MATCH_NOT_DATING' | 'PARTNER_NOT_FOUND' | 'INVALID_ID'> | DateTimeInvalid | DatePlanSaveError;

/**
 * Người mời đề xuất lịch gặp (BE-S7-01, `POST /me/dates`). Thứ tự: match đang mở của người dùng phải `DATING`
 * (facade matching — nguồn chân lý, ngoài transaction; không có / trạng thái khác → `MATCH_NOT_DATING`) → khung giờ hợp
 * lệ (`DATE_TIME_INVALID`) → quán tồn tại và đang hoạt động (facade billing; không → `PARTNER_NOT_FOUND`) → **một
 * transaction**: đã có lịch đang mở → `DATE_ALREADY_OPEN` (`meta.datePlanId`) → lưu + `DateProposed` vào outbox (hai
 * request đồng thời: partial unique index cho đúng một thành công, người sau `DATE_ALREADY_OPEN`) → hẹn job hết hạn
 * xác nhận cùng `tx` (rollback thì không có job).
 */
export class ProposeDate {
  constructor(private readonly deps: ProposeDateDeps) {}

  async execute(cmd: ProposeDateCommand): Promise<Result<DatePlanView, ProposeDateError>> {
    const match = await this.deps.matching.findOpenMatchForUser(cmd.userId);
    if (match === null || match.status !== 'DATING') {
      return fail('MATCH_NOT_DATING', { status: match?.status ?? null });
    }
    const userId = cmd.userId.toLowerCase();
    const inviteeId = match.participantIds.find((p) => p.toLowerCase() !== userId);
    if (inviteeId === undefined) throw new Error(`match ${match.matchId}: thiếu người còn lại của cặp`);

    const partnerId = parseId(cmd.partnerId);
    if (partnerId.isErr()) return fail('INVALID_ID', { field: 'partnerId' });

    const now = this.deps.clock.now();
    const proposed = DatePlan.propose(
      {
        id: newId<'DatePlan'>(),
        matchId: match.matchId,
        inviterId: userId,
        inviteeId,
        partnerId: partnerId.value,
        startsAt: cmd.startsAt,
        endsAt: cmd.endsAt,
        staffBookingRequested: cmd.staffBookingRequested,
      },
      now,
    );
    if (proposed.isErr()) return err(proposed.error);
    if (!(await this.deps.partners.isActivePartner(partnerId.value))) {
      return fail('PARTNER_NOT_FOUND', { field: 'partnerId' });
    }
    const plan = proposed.value;

    return this.deps.uow.run(async (tx): Promise<Result<DatePlanView, ProposeDateError>> => {
      const open = await this.deps.datePlans.findOpenByMatch(tx, plan.matchId);
      if (open !== null) return fail('DATE_ALREADY_OPEN', { datePlanId: open.id });
      const saved = await this.deps.datePlans.save(tx, plan);
      if (saved.isErr()) return err(saved.error);
      await this.deps.scheduler.schedule(tx, datePlanExpiryJob(plan));
      return ok(toDatePlanView(plan));
    });
  }
}
