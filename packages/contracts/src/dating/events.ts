/**
 * Event payload của aggregate `DatePlan` (phát qua outbox, BE-S7-01). Không chứa PII: chỉ id, mốc thời gian, cờ.
 * Thời gian dạng ISO 8601 UTC.
 */

/** Trạng thái lịch hẹn (khớp `DATE_PLAN_STATUSES` trong domain dating — có test đối chiếu). */
export const DATE_PLAN_STATUS_NAMES = [
  'PROPOSED',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type DatePlanStatusName = (typeof DATE_PLAN_STATUS_NAMES)[number];

/** Trường chung của mọi event lịch hẹn. */
export interface DatePlanEventBase {
  readonly datePlanId: string;
  readonly matchId: string;
  /** Người đề xuất lịch. */
  readonly inviterId: string;
  /** Người được mời — xác nhận / từ chối. */
  readonly inviteeId: string;
}

/** Người mời đề xuất lịch → `PROPOSED`. `expiresAt` = hạn xác nhận. */
export const DATE_PROPOSED = 'DateProposed';
export interface DateProposedPayload extends DatePlanEventBase {
  readonly partnerId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly staffBookingRequested: boolean;
  readonly expiresAt: string;
}

/**
 * Người được mời xác nhận → `CONFIRMED`. Billing kích hoạt voucher `RESERVED → ACTIVE` của `inviterId` (người mời —
 * mặc định tạm khi D1 chưa chốt); notification báo cả hai. `staffBookingRequested` → chuyên viên xác nhận đặt bàn.
 */
export const DATE_CONFIRMED = 'DateConfirmed';
export interface DateConfirmedPayload extends DatePlanEventBase {
  readonly partnerId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly staffBookingRequested: boolean;
}

/** Người được mời từ chối → `DECLINED`. */
export const DATE_DECLINED = 'DateDeclined';
export type DateDeclinedPayload = DatePlanEventBase;

/** Quá hạn xác nhận (job) → `EXPIRED`; người dùng đề xuất lịch mới được. */
export const DATE_EXPIRED = 'DateExpired';
export type DateExpiredPayload = DatePlanEventBase;

/** Lịch đã xác nhận bị huỷ (còn ≥ `DATE_CANCEL_CUTOFF_HOURS` giờ trước giờ bắt đầu) → `CANCELLED`. */
export const DATE_CANCELLED = 'DateCancelled';
export interface DateCancelledPayload extends DatePlanEventBase {
  readonly cancelledBy: string;
  readonly startsAt: string;
}
