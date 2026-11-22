import type { CheckInSource } from '../domain/date-plan.js';
import type { SafetyCheckIn } from '../domain/safety-check-in.js';

/** Check-in an toàn của người xem (BE-S7-02). Không chứa vị trí. */
export interface SafetyCheckInView {
  readonly id: string;
  readonly datePlanId: string;
  readonly userId: string;
  readonly source: CheckInSource;
  readonly checkedInAt: Date;
  readonly overdueAt: Date;
  readonly checkedOutAt: Date | null;
  readonly overdueAlertedAt: Date | null;
  readonly locationShared: boolean;
}

export function toSafetyCheckInView(checkIn: SafetyCheckIn): SafetyCheckInView {
  const s = checkIn.toState();
  return {
    id: s.id,
    datePlanId: s.datePlanId,
    userId: s.userId,
    source: s.source,
    checkedInAt: s.checkedInAt,
    overdueAt: s.overdueAt,
    checkedOutAt: s.checkedOutAt,
    overdueAlertedAt: s.overdueAlertedAt,
    locationShared: s.locationShared,
  };
}
