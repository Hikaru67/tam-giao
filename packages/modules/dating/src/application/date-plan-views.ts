import type { DatePlan, DatePlanState } from '../domain/date-plan.js';

/** Lịch hẹn trả cho presentation (đủ trạng thái + mốc huỷ cuối). Không có PII. */
export interface DatePlanView extends Omit<DatePlanState, 'version' | 'updatedAt'> {
  readonly cancelDeadline: Date;
}

export function toDatePlanView(plan: DatePlan): DatePlanView {
  const { version: _version, updatedAt: _updatedAt, ...rest } = plan.toState();
  return { ...rest, cancelDeadline: plan.cancelDeadline };
}
