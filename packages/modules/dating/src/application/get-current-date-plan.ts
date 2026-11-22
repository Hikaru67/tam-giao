import { ok, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { MatchingFacade } from '@tamgiao/module-matching/facade';
import { toDatePlanView, type DatePlanView } from './date-plan-views.js';
import type { DatePlanRepository } from './ports/date-plan-repository.js';

export interface GetCurrentDatePlanDeps {
  readonly uow: UnitOfWork;
  readonly datePlans: DatePlanRepository;
  readonly matching: Pick<MatchingFacade, 'findOpenMatchForUser'>;
}

/**
 * `GET /me/dates/current` (BE-S7-01): lịch mới nhất của match đang mở của người xem — mọi trạng thái, để màn đặt lịch
 * biết lịch vừa `EXPIRED`/`DECLINED`/`CANCELLED` và cho đề xuất lại. Không có match mở / chưa có lịch → `null`.
 */
export class GetCurrentDatePlan {
  constructor(private readonly deps: GetCurrentDatePlanDeps) {}

  async execute(query: { readonly userId: string }): Promise<Result<DatePlanView | null, never>> {
    const match = await this.deps.matching.findOpenMatchForUser(query.userId);
    if (match === null) return ok(null);
    return this.deps.uow.run(async (tx) => {
      const plan = await this.deps.datePlans.findLatestByMatch(tx, match.matchId);
      return ok(plan === null ? null : toDatePlanView(plan));
    });
  }
}
