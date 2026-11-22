import type { ScheduledJob } from '@tamgiao/kernel';
import type { SafetyCheckIn } from '../domain/safety-check-in.js';

/** Job cảnh báo quá hạn check-out (BE-S7-02): chạy lúc `overdueAt` của từng check-in → `MarkCheckInOverdue`. */
export const CHECK_IN_OVERDUE_QUEUE = 'dating.check-in-overdue';
/** Job xoá vị trí thô hết hạn lưu (BE-S7-02): hẹn lúc `purgeAfter` của từng vị trí; mỗi lần chạy quét xoá mọi vị trí hết hạn. */
export const CHECK_IN_LOCATION_PURGE_QUEUE = 'dating.purge-check-in-locations';

export type CheckInOverduePayload = {
  readonly checkInId: string;
};

/** Payload chỉ để truy vết — handler luôn quét toàn bộ vị trí hết hạn (bù cho job bị lỡ). */
export type CheckInLocationPurgePayload = {
  readonly checkInId: string;
};

/** Một job / check-in (khoá = id check-in): check-in chỉ tạo một lần, `overdueAt` không đổi. */
export function checkInOverdueJob(checkIn: SafetyCheckIn): ScheduledJob {
  const payload: CheckInOverduePayload = { checkInId: checkIn.id };
  return { queue: CHECK_IN_OVERDUE_QUEUE, key: checkIn.id, runAt: checkIn.overdueAt, payload };
}

export function checkInLocationPurgeJob(checkIn: SafetyCheckIn, purgeAfter: Date): ScheduledJob {
  const payload: CheckInLocationPurgePayload = { checkInId: checkIn.id };
  return { queue: CHECK_IN_LOCATION_PURGE_QUEUE, key: checkIn.id, runAt: purgeAfter, payload };
}
