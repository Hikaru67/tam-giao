import { CHECK_IN_OVERDUE_MINUTES } from '@tamgiao/contracts/constants';
import {
  AggregateRoot,
  addDuration,
  err,
  fail,
  ok,
  type DomainError,
  type Id,
  type Result,
} from '@tamgiao/kernel';
import type {
  CheckInSource,
  DateCheckInError,
  DatePlan,
  DatePlanId,
  DatingMatchId,
  DatingPartnerId,
  DatingUserId,
} from './date-plan.js';
import {
  DATE_CHECK_IN_OVERDUE,
  DATE_PARTICIPANT_CHECKED_IN,
  DATE_PARTICIPANT_CHECKED_OUT,
} from './date-plan-events.js';

export type SafetyCheckInId = Id<'SafetyCheckIn'>;

export type AlreadyCheckedIn = DomainError<'DATE_ALREADY_CHECKED_IN'>;
export type StartCheckInError = DateCheckInError | AlreadyCheckedIn;
export type CheckOutError = DomainError<'DATE_NOT_CHECKED_IN'>;
/** Job quá hạn bỏ qua (không phải lỗi người dùng): đã check-out / đã cảnh báo / chưa tới mốc. */
export type OverdueSkipReason = 'CHECKED_OUT' | 'ALREADY_ALERTED' | 'NOT_YET_DUE';

/** Snapshot để repository lưu / dựng lại (`toState` ↔ `restore`). Không chứa vị trí (lưu riêng, mã hoá, tự xoá). */
export interface SafetyCheckInState {
  readonly id: SafetyCheckInId;
  readonly datePlanId: DatePlanId;
  readonly matchId: DatingMatchId;
  readonly userId: DatingUserId;
  readonly partnerId: DatingPartnerId;
  readonly source: CheckInSource;
  readonly checkedInAt: Date;
  /** Giờ kết thúc buổi hẹn (chụp lúc check-in). */
  readonly dateEndsAt: Date;
  /** `dateEndsAt + CHECK_IN_OVERDUE_MINUTES`: quá mốc này chưa check-out → cảnh báo chuyên viên. */
  readonly overdueAt: Date;
  readonly checkedOutAt: Date | null;
  readonly overdueAlertedAt: Date | null;
  /** Có gửi vị trí thô kèm check-in không (giữ cờ kể cả sau khi vị trí đã bị xoá). */
  readonly locationShared: boolean;
  readonly updatedAt: Date;
  readonly version: number;
}

type MutableState = Omit<SafetyCheckInState, 'version'>;

/**
 * Aggregate `SafetyCheckIn` — check-in an toàn của **một người** cho một lịch hẹn (BE-S7-02); mỗi (lịch, người) tối đa
 * một bản ghi (unique ở DB, A10). Vòng đời: `start` → (`markOverdue`)? → `checkOut`.
 *
 * - `start`: lịch phải cho phép check-in (`DatePlan.markCheckedIn` — người trong cặp, lịch `CONFIRMED | CHECKED_IN`,
 *   trong khung giờ hẹn); đã có bản ghi → `DATE_ALREADY_CHECKED_IN`. Người đầu tiên chuyển lịch sang `CHECKED_IN`.
 *   Phát `DateParticipantCheckedIn`.
 * - `checkOut`: đã check-out → `DATE_NOT_CHECKED_IN` (`reason: ALREADY_CHECKED_OUT`). Được check-out cả sau cảnh báo
 *   quá hạn (`wasOverdue` để chuyên viên đóng cảnh báo). Phát `DateParticipantCheckedOut`.
 * - `markOverdue` (job): chưa check-out, chưa cảnh báo, `now >= overdueAt` → ghi `overdueAlertedAt` + phát
 *   `DateCheckInOverdue` (tối đa một lần). Còn lại trả lý do bỏ qua.
 */
export class SafetyCheckIn extends AggregateRoot<SafetyCheckInId> {
  protected readonly aggregateType = 'SafetyCheckIn';

  private constructor(
    private state: MutableState,
    version: number,
  ) {
    super(state.id, version);
  }

  /**
   * Tạo check-in cho `userId` lúc `at` và cập nhật lịch (`plan` phải được khoá trong cùng transaction). `existing` là
   * bản ghi check-in hiện có của người này cho lịch (nếu có).
   */
  static start(
    input: {
      readonly id: SafetyCheckInId;
      readonly plan: DatePlan;
      readonly existing: SafetyCheckIn | null;
      readonly userId: DatingUserId;
      readonly source: CheckInSource;
      readonly locationShared: boolean;
    },
    at: Date,
  ): Result<SafetyCheckIn, StartCheckInError> {
    const { plan } = input;
    const allowed = plan.ensureCanCheckIn(input.userId, at);
    if (allowed.isErr()) return err(allowed.error);
    if (input.existing !== null) {
      return fail('DATE_ALREADY_CHECKED_IN', { checkInId: input.existing.id });
    }
    const marked = plan.markCheckedIn(input.userId, input.source, at);
    if (marked.isErr()) return err(marked.error);

    const userId = input.userId.toLowerCase();
    const dateEndsAt = new Date(plan.endsAt.getTime());
    const overdueAt = addDuration(dateEndsAt, { minutes: CHECK_IN_OVERDUE_MINUTES });
    const checkIn = new SafetyCheckIn(
      {
        id: input.id,
        datePlanId: plan.id,
        matchId: plan.matchId,
        userId,
        partnerId: plan.partnerId,
        source: input.source,
        checkedInAt: new Date(at.getTime()),
        dateEndsAt,
        overdueAt,
        checkedOutAt: null,
        overdueAlertedAt: null,
        locationShared: input.locationShared,
        updatedAt: new Date(at.getTime()),
      },
      0,
    );
    checkIn.record(
      DATE_PARTICIPANT_CHECKED_IN,
      {
        ...checkIn.eventBase(),
        partnerId: checkIn.state.partnerId,
        source: input.source,
        checkedInAt: checkIn.state.checkedInAt.toISOString(),
        overdueAt: overdueAt.toISOString(),
        locationShared: input.locationShared,
      },
      at,
    );
    return ok(checkIn);
  }

  static restore(state: SafetyCheckInState): SafetyCheckIn {
    const { version, ...rest } = state;
    return new SafetyCheckIn(rest, version);
  }

  get datePlanId(): DatePlanId {
    return this.state.datePlanId;
  }

  get userId(): DatingUserId {
    return this.state.userId;
  }

  get overdueAt(): Date {
    return this.state.overdueAt;
  }

  get checkedOutAt(): Date | null {
    return this.state.checkedOutAt;
  }

  get overdueAlertedAt(): Date | null {
    return this.state.overdueAlertedAt;
  }

  isCheckedOut(): boolean {
    return this.state.checkedOutAt !== null;
  }

  checkOut(at: Date): Result<void, CheckOutError> {
    if (this.state.checkedOutAt !== null) {
      return fail('DATE_NOT_CHECKED_IN', { reason: 'ALREADY_CHECKED_OUT' });
    }
    this.state = { ...this.state, checkedOutAt: at, updatedAt: at };
    this.record(
      DATE_PARTICIPANT_CHECKED_OUT,
      {
        ...this.eventBase(),
        checkedOutAt: at.toISOString(),
        wasOverdue: this.state.overdueAlertedAt !== null,
      },
      at,
    );
    return ok();
  }

  /** Job cảnh báo quá hạn. `Err` mang lý do bỏ qua (job no-op), không phải lỗi người dùng. */
  markOverdue(now: Date): Result<void, OverdueSkipReason> {
    if (this.state.checkedOutAt !== null) return err('CHECKED_OUT');
    if (this.state.overdueAlertedAt !== null) return err('ALREADY_ALERTED');
    if (now.getTime() < this.state.overdueAt.getTime()) return err('NOT_YET_DUE');
    this.state = { ...this.state, overdueAlertedAt: now, updatedAt: now };
    this.record(
      DATE_CHECK_IN_OVERDUE,
      {
        ...this.eventBase(),
        partnerId: this.state.partnerId,
        checkedInAt: this.state.checkedInAt.toISOString(),
        endsAt: this.state.dateEndsAt.toISOString(),
        overdueAt: this.state.overdueAt.toISOString(),
      },
      now,
    );
    return ok();
  }

  toState(): SafetyCheckInState {
    return { ...this.state, version: this.version };
  }

  private eventBase() {
    return {
      checkInId: this.id,
      datePlanId: this.state.datePlanId,
      matchId: this.state.matchId,
      userId: this.state.userId,
    };
  }
}
