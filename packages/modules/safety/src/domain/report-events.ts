/**
 * Tên event của aggregate `Report`. Domain không được import contracts ngoài `constants` (A1) nên giữ bản sao ở đây;
 * test `safety-errors.test.ts` bảo đảm khớp với `@tamgiao/contracts` (`safety/events.ts`), nơi khai báo payload.
 */
export const REPORT_FILED = 'ReportFiled';
export const REPORT_STATUS_CHANGED = 'ReportStatusChanged';

export const REPORT_EVENT_TYPES = [REPORT_FILED, REPORT_STATUS_CHANGED] as const;

/** Event của aggregate `UserBan` (BE-S6-06) — khớp `USER_BANNED` ở contracts. */
export const USER_BANNED = 'UserBanned';
