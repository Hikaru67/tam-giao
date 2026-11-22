import { DATE_CANCEL_CUTOFF_HOURS, DATE_RESPONSE_TTL_HOURS } from '@tamgiao/contracts/constants';
import {
  AggregateRoot,
  addDuration,
  fail,
  ok,
  type DomainError,
  type Id,
  type Result,
} from '@tamgiao/kernel';
import {
  DATE_CANCELLED,
  DATE_CHECKED_IN,
  DATE_CONFIRMED,
  DATE_DECLINED,
  DATE_EXPIRED,
  DATE_PROPOSED,
} from './date-plan-events.js';

export type DatePlanId = Id<'DatePlan'>;
/** Id tài khoản app (module identity) — dating chỉ giữ tham chiếu (A3). */
export type DatingUserId = string;
/** Id match (module matching) — dating chỉ giữ tham chiếu, đọc qua facade. */
export type DatingMatchId = string;
/** Id quán đối tác (module billing) — dating chỉ giữ tham chiếu, kiểm tra qua facade. */
export type DatingPartnerId = string;

/**
 * Vòng đời lịch hẹn: `PROPOSED → CONFIRMED → CHECKED_IN → COMPLETED`; `PROPOSED → DECLINED | EXPIRED`;
 * `CONFIRMED → CANCELLED`. `CHECKED_IN`/`COMPLETED` do BE-S7-02/BE-S7-04 hiện thực (đã có trong CHECK của DB).
 */
export const DATE_PLAN_STATUSES = [
  'PROPOSED',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type DatePlanStatus = (typeof DATE_PLAN_STATUSES)[number];

/** Lịch "đang mở" — mỗi match tối đa một lịch ở các trạng thái này (partial unique index ở DB, A10). */
export const OPEN_DATE_PLAN_STATUSES = ['PROPOSED', 'CONFIRMED', 'CHECKED_IN'] as const satisfies readonly DatePlanStatus[];

export type DateTimeInvalid = DomainError<'DATE_TIME_INVALID'>;
export type DateTransitionError = DomainError<'DATE_INVALID_TRANSITION'>;
export type DateRespondError =
  | DomainError<'NOT_PARTICIPANT' | 'DATE_NOT_INVITEE' | 'DATE_RESPONSE_EXPIRED'>
  | DateTransitionError;
export type DateCancelError = DomainError<'NOT_PARTICIPANT' | 'CANCEL_TOO_LATE'> | DateTransitionError;
/** Check-in an toàn (BE-S7-02): ngoài khung giờ hẹn → `DATE_CHECK_IN_WINDOW_CLOSED`. */
export type DateCheckInError =
  | DomainError<'NOT_PARTICIPANT' | 'DATE_CHECK_IN_WINDOW_CLOSED'>
  | DateTransitionError;
/** Nguồn check-in: người dùng bật "Check-in an toàn" / quán quét voucher (`VoucherRedeemed`). */
export const CHECK_IN_SOURCES = ['MANUAL', 'VOUCHER'] as const;
export type CheckInSource = (typeof CHECK_IN_SOURCES)[number];

/** Snapshot đầy đủ để repository lưu / dựng lại aggregate (`toState` ↔ `restore`). */
export interface DatePlanState {
  readonly id: DatePlanId;
  readonly matchId: DatingMatchId;
  /** Người đề xuất (chọn ngày, khung giờ, quán). */
  readonly inviterId: DatingUserId;
  /** Người còn lại của cặp — xác nhận / từ chối. */
  readonly inviteeId: DatingUserId;
  readonly partnerId: DatingPartnerId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Tuỳ chọn "Chuyên viên xác nhận đặt bàn". */
  readonly staffBookingRequested: boolean;
  readonly status: DatePlanStatus;
  readonly proposedAt: Date;
  /** Hạn xác nhận = `min(proposedAt + DATE_RESPONSE_TTL_HOURS, startsAt)`. */
  readonly expiresAt: Date;
  /** Lúc xác nhận / từ chối / hết hạn. */
  readonly respondedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelledBy: DatingUserId | null;
  readonly updatedAt: Date;
  readonly version: number;
}

type MutableState = Omit<DatePlanState, 'version'>;

const isOpenStatus = (status: DatePlanStatus): boolean =>
  (OPEN_DATE_PLAN_STATUSES as readonly DatePlanStatus[]).includes(status);

const invalidTransition = (action: string, status: DatePlanStatus): Result<never, DateTransitionError> =>
  fail('DATE_INVALID_TRANSITION', { action, status });

/**
 * Aggregate `DatePlan` — lịch gặp mặt tại quán đối tác của một match đang `DATING` (BE-S7-01).
 *
 * - `propose`: giờ bắt đầu phải sau `now`, giờ kết thúc sau giờ bắt đầu (`DATE_TIME_INVALID`); hạn xác nhận
 *   `DATE_RESPONSE_TTL_HOURS` giờ nhưng không quá giờ bắt đầu (không xác nhận một buổi hẹn đã bắt đầu). Phát `DateProposed`.
 * - `confirm` / `decline` (người được mời): người ngoài cặp → `NOT_PARTICIPANT` (kiểm tra trước, không lộ trạng thái)
 *   → người mời → `DATE_NOT_INVITEE` → không còn `PROPOSED` → `DATE_INVALID_TRANSITION` → `now >= expiresAt` →
 *   `DATE_RESPONSE_EXPIRED`. Phát `DateConfirmed` / `DateDeclined`.
 * - `cancel` (một trong hai người): chỉ khi `CONFIRMED` và `now <= startsAt − DATE_CANCEL_CUTOFF_HOURS` (đúng biên
 *   được phép), quá → `CANCEL_TOO_LATE`. Phát `DateCancelled`.
 * - `expire` (job): `PROPOSED` và `now >= expiresAt` → `EXPIRED`, phát `DateExpired`; còn lại `DATE_INVALID_TRANSITION`.
 */
export class DatePlan extends AggregateRoot<DatePlanId> {
  protected readonly aggregateType = 'DatePlan';

  private constructor(
    private state: MutableState,
    version: number,
  ) {
    super(state.id, version);
  }

  static propose(
    input: {
      readonly id: DatePlanId;
      readonly matchId: DatingMatchId;
      readonly inviterId: DatingUserId;
      readonly inviteeId: DatingUserId;
      readonly partnerId: DatingPartnerId;
      readonly startsAt: Date;
      readonly endsAt: Date;
      readonly staffBookingRequested: boolean;
    },
    now: Date,
  ): Result<DatePlan, DateTimeInvalid> {
    const inviterId = input.inviterId.toLowerCase();
    const inviteeId = input.inviteeId.toLowerCase();
    if (inviterId === inviteeId) throw new Error('DatePlan cần hai người khác nhau');
    if (input.startsAt.getTime() <= now.getTime()) {
      return fail('DATE_TIME_INVALID', { reason: 'STARTS_IN_PAST' });
    }
    if (input.endsAt.getTime() <= input.startsAt.getTime()) {
      return fail('DATE_TIME_INVALID', { reason: 'ENDS_BEFORE_START' });
    }
    const ttlEnd = addDuration(now, { hours: DATE_RESPONSE_TTL_HOURS });
    const expiresAt = new Date(Math.min(ttlEnd.getTime(), input.startsAt.getTime()));
    const plan = new DatePlan(
      {
        id: input.id,
        matchId: input.matchId.toLowerCase(),
        inviterId,
        inviteeId,
        partnerId: input.partnerId.toLowerCase(),
        startsAt: new Date(input.startsAt.getTime()),
        endsAt: new Date(input.endsAt.getTime()),
        staffBookingRequested: input.staffBookingRequested,
        status: 'PROPOSED',
        proposedAt: new Date(now.getTime()),
        expiresAt,
        respondedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        updatedAt: new Date(now.getTime()),
      },
      0,
    );
    plan.record(
      DATE_PROPOSED,
      {
        ...plan.eventBase(),
        partnerId: plan.state.partnerId,
        startsAt: plan.state.startsAt.toISOString(),
        endsAt: plan.state.endsAt.toISOString(),
        staffBookingRequested: plan.state.staffBookingRequested,
        expiresAt: expiresAt.toISOString(),
      },
      now,
    );
    return ok(plan);
  }

  static restore(state: DatePlanState): DatePlan {
    const { version, ...rest } = state;
    return new DatePlan(rest, version);
  }

  get matchId(): DatingMatchId {
    return this.state.matchId;
  }

  get inviterId(): DatingUserId {
    return this.state.inviterId;
  }

  get inviteeId(): DatingUserId {
    return this.state.inviteeId;
  }

  get status(): DatePlanStatus {
    return this.state.status;
  }

  get expiresAt(): Date {
    return this.state.expiresAt;
  }

  get startsAt(): Date {
    return this.state.startsAt;
  }

  get endsAt(): Date {
    return this.state.endsAt;
  }

  get partnerId(): DatingPartnerId {
    return this.state.partnerId;
  }

  /** Mốc cuối còn được huỷ lịch đã xác nhận. */
  get cancelDeadline(): Date {
    return addDuration(this.state.startsAt, { hours: -DATE_CANCEL_CUTOFF_HOURS });
  }

  isOpen(): boolean {
    return isOpenStatus(this.state.status);
  }

  isParticipant(userId: DatingUserId): boolean {
    const id = userId.toLowerCase();
    return id === this.state.inviterId || id === this.state.inviteeId;
  }

  confirm(userId: DatingUserId, now: Date): Result<void, DateRespondError> {
    const allowed = this.ensureCanRespond('confirm', userId, now);
    if (allowed.isErr()) return allowed;
    this.state = { ...this.state, status: 'CONFIRMED', respondedAt: now, updatedAt: now };
    this.record(
      DATE_CONFIRMED,
      {
        ...this.eventBase(),
        partnerId: this.state.partnerId,
        startsAt: this.state.startsAt.toISOString(),
        endsAt: this.state.endsAt.toISOString(),
        staffBookingRequested: this.state.staffBookingRequested,
      },
      now,
    );
    return ok();
  }

  decline(userId: DatingUserId, now: Date): Result<void, DateRespondError> {
    const allowed = this.ensureCanRespond('decline', userId, now);
    if (allowed.isErr()) return allowed;
    this.state = { ...this.state, status: 'DECLINED', respondedAt: now, updatedAt: now };
    this.record(DATE_DECLINED, this.eventBase(), now);
    return ok();
  }

  cancel(userId: DatingUserId, now: Date): Result<void, DateCancelError> {
    if (!this.isParticipant(userId)) return fail('NOT_PARTICIPANT');
    if (this.state.status !== 'CONFIRMED') return invalidTransition('cancel', this.state.status);
    const deadline = this.cancelDeadline;
    if (now.getTime() > deadline.getTime()) {
      return fail('CANCEL_TOO_LATE', { cancelDeadline: deadline.toISOString() });
    }
    const cancelledBy = userId.toLowerCase();
    this.state = { ...this.state, status: 'CANCELLED', cancelledAt: now, cancelledBy, updatedAt: now };
    this.record(
      DATE_CANCELLED,
      { ...this.eventBase(), cancelledBy, startsAt: this.state.startsAt.toISOString() },
      now,
    );
    return ok();
  }

  /** Job hết hạn: `PROPOSED` quá `expiresAt` → `EXPIRED`. Không còn `PROPOSED` / chưa tới hạn → lỗi, job bỏ qua. */
  expire(now: Date): Result<void, DateTransitionError> {
    if (this.state.status !== 'PROPOSED') return invalidTransition('expire', this.state.status);
    if (now.getTime() < this.state.expiresAt.getTime()) {
      return fail('DATE_INVALID_TRANSITION', {
        action: 'expire',
        status: this.state.status,
        reason: 'not_expired',
      });
    }
    this.state = { ...this.state, status: 'EXPIRED', respondedAt: now, updatedAt: now };
    this.record(DATE_EXPIRED, this.eventBase(), now);
    return ok();
  }

  /** Thời điểm `at` nằm trong khung giờ hẹn `[startsAt, endsAt]` (đúng biên được tính là trong khung). */
  isWithinDateWindow(at: Date): boolean {
    return at.getTime() >= this.state.startsAt.getTime() && at.getTime() <= this.state.endsAt.getTime();
  }

  /**
   * Kiểm tra một người check-in an toàn được không (BE-S7-02), không đổi trạng thái: người ngoài cặp →
   * `NOT_PARTICIPANT` (trước, không lộ trạng thái) → lịch không ở `CONFIRMED | CHECKED_IN` →
   * `DATE_INVALID_TRANSITION` → `at` ngoài khung giờ hẹn → `DATE_CHECK_IN_WINDOW_CLOSED`.
   */
  ensureCanCheckIn(userId: DatingUserId, at: Date): Result<void, DateCheckInError> {
    if (!this.isParticipant(userId)) return fail('NOT_PARTICIPANT');
    if (this.state.status !== 'CONFIRMED' && this.state.status !== 'CHECKED_IN') {
      return invalidTransition('check_in', this.state.status);
    }
    if (!this.isWithinDateWindow(at)) {
      return fail('DATE_CHECK_IN_WINDOW_CLOSED', {
        startsAt: this.state.startsAt.toISOString(),
        endsAt: this.state.endsAt.toISOString(),
      });
    }
    return ok();
  }

  /**
   * Người đầu tiên check-in (thủ công hoặc quét voucher) → `CONFIRMED → CHECKED_IN` + `DateCheckedIn`. Lịch đã
   * `CHECKED_IN` (người thứ hai check-in) → no-op, không phát event. Luật được kiểm tra lại như `ensureCanCheckIn`.
   */
  markCheckedIn(userId: DatingUserId, source: CheckInSource, at: Date): Result<void, DateCheckInError> {
    const allowed = this.ensureCanCheckIn(userId, at);
    if (allowed.isErr()) return allowed;
    if (this.state.status === 'CHECKED_IN') return ok();
    this.state = { ...this.state, status: 'CHECKED_IN', updatedAt: at };
    this.record(
      DATE_CHECKED_IN,
      {
        ...this.eventBase(),
        partnerId: this.state.partnerId,
        startsAt: this.state.startsAt.toISOString(),
        endsAt: this.state.endsAt.toISOString(),
        checkedInBy: userId.toLowerCase(),
        source,
      },
      at,
    );
    return ok();
  }

  toState(): DatePlanState {
    return { ...this.state, version: this.version };
  }

  private ensureCanRespond(
    action: 'confirm' | 'decline',
    userId: DatingUserId,
    now: Date,
  ): Result<void, DateRespondError> {
    if (!this.isParticipant(userId)) return fail('NOT_PARTICIPANT');
    if (userId.toLowerCase() !== this.state.inviteeId) return fail('DATE_NOT_INVITEE');
    if (this.state.status !== 'PROPOSED') return invalidTransition(action, this.state.status);
    if (now.getTime() >= this.state.expiresAt.getTime()) {
      return fail('DATE_RESPONSE_EXPIRED', { expiresAt: this.state.expiresAt.toISOString() });
    }
    return ok();
  }

  private eventBase() {
    return {
      datePlanId: this.id,
      matchId: this.state.matchId,
      inviterId: this.state.inviterId,
      inviteeId: this.state.inviteeId,
    };
  }
}
