/**
 * Tên event của aggregate `DatePlan`. Domain không được import contracts ngoài `constants` (A1) nên giữ bản sao ở đây;
 * test `dating-contracts.test.ts` bảo đảm khớp với `@tamgiao/contracts` (`dating/events.ts`), nơi khai báo payload.
 */
export const DATE_PROPOSED = 'DateProposed';
export const DATE_CONFIRMED = 'DateConfirmed';
export const DATE_DECLINED = 'DateDeclined';
export const DATE_EXPIRED = 'DateExpired';
export const DATE_CANCELLED = 'DateCancelled';
/** BE-S7-02: lịch `CONFIRMED → CHECKED_IN` khi người đầu tiên check-in. */
export const DATE_CHECKED_IN = 'DateCheckedIn';
/** BE-S7-04: lịch `CONFIRMED | CHECKED_IN → COMPLETED` khi có đánh giá đầu tiên. */
export const DATE_COMPLETED = 'DateCompleted';
/** BE-S7-02: event của aggregate `SafetyCheckIn` (mỗi người một bản ghi check-in / lịch). */
export const DATE_PARTICIPANT_CHECKED_IN = 'DateParticipantCheckedIn';
export const DATE_PARTICIPANT_CHECKED_OUT = 'DateParticipantCheckedOut';
export const DATE_CHECK_IN_OVERDUE = 'DateCheckInOverdue';

export const DATING_EVENT_TYPES = [
  DATE_PROPOSED,
  DATE_CONFIRMED,
  DATE_DECLINED,
  DATE_EXPIRED,
  DATE_CANCELLED,
  DATE_CHECKED_IN,
  DATE_COMPLETED,
  DATE_PARTICIPANT_CHECKED_IN,
  DATE_PARTICIPANT_CHECKED_OUT,
  DATE_CHECK_IN_OVERDUE,
] as const;
