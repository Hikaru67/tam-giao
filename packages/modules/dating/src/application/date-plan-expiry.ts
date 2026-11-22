import type { ScheduledJob } from '@tamgiao/kernel';
import type { DatePlan } from '../domain/date-plan.js';

/** Hàng đợi job hết hạn xác nhận lịch hẹn (pg-boss). Worker đăng ký handler `ExpireDatePlan` (BE-S7-01). */
export const DATE_PLAN_EXPIRY_QUEUE = 'dating.expire-date-plan';

/** Hàng đợi API gửi job vào — tạo sẵn khi API khởi động (`startApiJobScheduler`). */
export const DATING_SCHEDULED_QUEUES: readonly string[] = [DATE_PLAN_EXPIRY_QUEUE];

/** Payload job — chỉ id, không PII. Khai báo `type` để gán được vào `ScheduledJob.payload`. */
export type DatePlanExpiryPayload = {
  readonly datePlanId: string;
};

/** Job hết hạn cho lịch vừa đề xuất: khoá `<datePlanId>:<version>`, chạy lúc `expiresAt`. */
export function datePlanExpiryJob(plan: DatePlan): ScheduledJob {
  const payload: DatePlanExpiryPayload = { datePlanId: plan.id };
  return {
    queue: DATE_PLAN_EXPIRY_QUEUE,
    key: `${plan.id}:${plan.version}`,
    runAt: plan.expiresAt,
    payload,
  };
}
