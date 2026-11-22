/**
 * Tên event của aggregate `DatePlan`. Domain không được import contracts ngoài `constants` (A1) nên giữ bản sao ở đây;
 * test `dating-contracts.test.ts` bảo đảm khớp với `@tamgiao/contracts` (`dating/events.ts`), nơi khai báo payload.
 */
export const DATE_PROPOSED = 'DateProposed';
export const DATE_CONFIRMED = 'DateConfirmed';
export const DATE_DECLINED = 'DateDeclined';
export const DATE_EXPIRED = 'DateExpired';
export const DATE_CANCELLED = 'DateCancelled';

export const DATING_EVENT_TYPES = [
  DATE_PROPOSED,
  DATE_CONFIRMED,
  DATE_DECLINED,
  DATE_EXPIRED,
  DATE_CANCELLED,
] as const;
