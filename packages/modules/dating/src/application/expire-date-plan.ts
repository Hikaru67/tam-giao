import { ok, parseId, type Clock, type Tx, type UnitOfWork } from '@tamgiao/kernel';
import type { DatePlanStatus } from '../domain/date-plan.js';
import type { DatePlanExpiryPayload } from './date-plan-expiry.js';
import type { DatePlanRepository } from './ports/date-plan-repository.js';

export interface ExpireDatePlanDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly datePlans: DatePlanRepository;
}

/**
 * Kết quả một lần chạy job (để log, không phải lỗi):
 * - `EXPIRED`: lịch `PROPOSED` quá hạn xác nhận → `EXPIRED` (+ `DateExpired`).
 * - `NOT_YET_EXPIRED`: còn `PROPOSED` nhưng chưa tới hạn (job chạy sớm) → no-op, pg-boss không chạy lại; không xảy ra
 *   khi job được hẹn đúng `expiresAt`.
 * - `ALREADY_RESOLVED`: lịch đã được xác nhận / từ chối / hết hạn trước đó (job chạy lại) → no-op.
 * - `NOT_FOUND`: không có lịch → no-op.
 */
export type ExpireDatePlanOutcome =
  | { readonly kind: 'EXPIRED' }
  | { readonly kind: 'NOT_YET_EXPIRED' | 'ALREADY_RESOLVED'; readonly status: DatePlanStatus }
  | { readonly kind: 'NOT_FOUND' };

/**
 * Handler job `dating.expire-date-plan` (BE-S7-01, AC3). Idempotent (A9): khoá lịch `FOR UPDATE` rồi để domain
 * `expire(now)` quyết định theo trạng thái + thời gian hiện tại. Payload sai dạng là lỗi lập trình → throw.
 */
export class ExpireDatePlan {
  constructor(private readonly deps: ExpireDatePlanDeps) {}

  /** Chạy trong transaction riêng (test, gọi trực tiếp). */
  async execute(payload: DatePlanExpiryPayload): Promise<ExpireDatePlanOutcome> {
    const result = await this.deps.uow.run(async (tx) => ok(await this.executeIn(tx, payload)));
    if (result.isErr()) throw new Error('unreachable');
    return result.value;
  }

  /** Chạy trong `tx` của caller (worker: `registerJob` đã mở transaction). */
  async executeIn(tx: Tx, payload: DatePlanExpiryPayload): Promise<ExpireDatePlanOutcome> {
    const id = parseId<'DatePlan'>(payload.datePlanId);
    if (id.isErr()) throw new Error('dating.expire-date-plan: datePlanId không hợp lệ');

    const plan = await this.deps.datePlans.findByIdForUpdate(tx, id.value);
    if (plan === null) return { kind: 'NOT_FOUND' };
    const status = plan.status;
    if (status !== 'PROPOSED') return { kind: 'ALREADY_RESOLVED', status };
    const expired = plan.expire(this.deps.clock.now());
    if (expired.isErr()) return { kind: 'NOT_YET_EXPIRED', status };

    const saved = await this.deps.datePlans.save(tx, plan);
    if (saved.isErr()) throw new Error(`dating.date_plans ${plan.id}: ${saved.error.code} khi hết hạn`);
    return { kind: 'EXPIRED' };
  }
}
