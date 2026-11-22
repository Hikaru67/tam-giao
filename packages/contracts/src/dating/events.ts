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

/** Nguồn check-in an toàn (BE-S7-02): người dùng bật toggle / quán quét voucher (`VoucherRedeemed`). */
export const CHECK_IN_SOURCE_NAMES = ['MANUAL', 'VOUCHER'] as const;
export type CheckInSourceName = (typeof CHECK_IN_SOURCE_NAMES)[number];

/**
 * Người đầu tiên check-in → lịch `CONFIRMED → CHECKED_IN` (BE-S7-02). Phát một lần / lịch (người thứ hai check-in chỉ
 * phát `DateParticipantCheckedIn`).
 */
export const DATE_CHECKED_IN = 'DateCheckedIn';
export interface DateCheckedInPayload extends DatePlanEventBase {
  readonly partnerId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly checkedInBy: string;
  readonly source: CheckInSourceName;
}

/** Trường chung của event check-in an toàn từng người (aggregate `SafetyCheckIn`, BE-S7-02). Không có vị trí. */
export interface SafetyCheckInEventBase {
  readonly checkInId: string;
  readonly datePlanId: string;
  readonly matchId: string;
  readonly userId: string;
}

/**
 * Một người check-in an toàn (BE-S7-02). `overdueAt` = giờ kết thúc + `CHECK_IN_OVERDUE_MINUTES`: quá mốc này chưa
 * check-out → `DateCheckInOverdue`. `locationShared` = có gửi vị trí cho chuyên viên (vị trí không nằm trong event).
 */
export const DATE_PARTICIPANT_CHECKED_IN = 'DateParticipantCheckedIn';
export interface DateParticipantCheckedInPayload extends SafetyCheckInEventBase {
  readonly partnerId: string;
  readonly source: CheckInSourceName;
  readonly checkedInAt: string;
  readonly overdueAt: string;
  readonly locationShared: boolean;
}

/** Người đã check-in bấm check-out (BE-S7-02). `wasOverdue` = đã bị cảnh báo quá hạn trước đó (chuyên viên đóng cảnh báo). */
export const DATE_PARTICIPANT_CHECKED_OUT = 'DateParticipantCheckedOut';
export interface DateParticipantCheckedOutPayload extends SafetyCheckInEventBase {
  readonly checkedOutAt: string;
  readonly wasOverdue: boolean;
}

/**
 * Cảnh báo chuyên viên (BE-S7-02): quá giờ kết thúc buổi hẹn + `CHECK_IN_OVERDUE_MINUTES` mà người đã check-in chưa
 * check-out. Phát tối đa một lần / check-in (job idempotent).
 */
export const DATE_CHECK_IN_OVERDUE = 'DateCheckInOverdue';
export interface DateCheckInOverduePayload extends SafetyCheckInEventBase {
  readonly partnerId: string;
  readonly checkedInAt: string;
  readonly endsAt: string;
  readonly overdueAt: string;
}
