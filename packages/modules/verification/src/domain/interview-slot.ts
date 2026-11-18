import { INTERVIEW_CHANGE_CUTOFF_HOURS, INTERVIEW_DURATION_MINUTES } from '@tamgiao/contracts/constants';
import { Entity, addDuration, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';
import type { KycStepOutcome, KycUserId, ReviewerId } from './kyc-submission.js';

export type InterviewSlotId = Id<'InterviewSlot'>;

/**
 * `OPEN` (còn trống) → `BOOKED` (người dùng đã đặt; huỷ thì quay lại `OPEN`) → `COMPLETED` (chuyên viên đã ghi
 * nhận xét + kết quả). Slot `COMPLETED` giữ người đã đặt để làm nhật ký phỏng vấn.
 */
export const INTERVIEW_SLOT_STATUSES = ['OPEN', 'BOOKED', 'COMPLETED'] as const;
export type InterviewSlotStatus = (typeof INTERVIEW_SLOT_STATUSES)[number];

export const INTERVIEW_OUTCOMES = ['PASSED', 'FAILED'] as const satisfies readonly KycStepOutcome[];
export type InterviewOutcome = (typeof INTERVIEW_OUTCOMES)[number];

export interface InterviewSlotState {
  readonly id: InterviewSlotId;
  /** Chuyên viên mở slot (admin của module identity). */
  readonly interviewerId: ReviewerId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Link gọi video (công cụ ngoài) — chỉ trả cho người đã đặt và chuyên viên. */
  readonly meetingUrl: string | null;
  readonly status: InterviewSlotStatus;
  readonly bookedBy: KycUserId | null;
  readonly bookedAt: Date | null;
  readonly outcome: InterviewOutcome | null;
  /** Nhận xét phỏng vấn — có thể chứa thông tin cá nhân: không log, không đưa vào event. */
  readonly notes: string | null;
  readonly recordedBy: ReviewerId | null;
  readonly recordedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type InterviewOpenError = DomainError<'INTERVIEW_SLOT_IN_PAST'>;
export type InterviewBookError = DomainError<'SLOT_TAKEN' | 'INTERVIEW_SLOT_IN_PAST'>;
export type InterviewCancelError = DomainError<'INTERVIEW_NOT_BOOKED' | 'CANCEL_TOO_LATE'>;
export type InterviewRecordError = DomainError<'INTERVIEW_NOT_BOOKED' | 'INTERVIEW_NOT_STARTED'>;

/**
 * Một khung giờ phỏng vấn sơ bộ (`INTERVIEW_DURATION_MINUTES` phút) do chuyên viên mở. Luật xuyên aggregate
 * (một slot một người; mỗi người tối đa một lịch đang hoạt động) do DB bảo đảm: khoá dòng slot khi đặt + partial
 * unique index trên `booked_by` (AGENTS.md A10).
 */
export class InterviewSlot extends Entity<InterviewSlotId> {
  private constructor(private state: InterviewSlotState) {
    super(state.id);
  }

  /** Mở slot mới; giờ bắt đầu phải ở tương lai. Thời lượng cố định `INTERVIEW_DURATION_MINUTES`. */
  static open(
    input: {
      readonly id: InterviewSlotId;
      readonly interviewerId: ReviewerId;
      readonly startsAt: Date;
      readonly meetingUrl?: string | null;
    },
    now: Date,
  ): Result<InterviewSlot, InterviewOpenError> {
    if (input.startsAt.getTime() <= now.getTime()) return fail('INTERVIEW_SLOT_IN_PAST');
    const meetingUrl = input.meetingUrl?.trim() ?? '';
    return ok(
      new InterviewSlot({
        id: input.id,
        interviewerId: input.interviewerId,
        startsAt: new Date(input.startsAt.getTime()),
        endsAt: addDuration(input.startsAt, { minutes: INTERVIEW_DURATION_MINUTES }),
        meetingUrl: meetingUrl.length > 0 ? meetingUrl : null,
        status: 'OPEN',
        bookedBy: null,
        bookedAt: null,
        outcome: null,
        notes: null,
        recordedBy: null,
        recordedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  static restore(state: InterviewSlotState): InterviewSlot {
    return new InterviewSlot({ ...state });
  }

  get status(): InterviewSlotStatus {
    return this.state.status;
  }

  get bookedBy(): KycUserId | null {
    return this.state.bookedBy;
  }

  get startsAt(): Date {
    return this.state.startsAt;
  }

  get endsAt(): Date {
    return this.state.endsAt;
  }

  /** Mốc cuối cùng còn được huỷ/đổi lịch (= giờ bắt đầu − `INTERVIEW_CHANGE_CUTOFF_HOURS`). */
  get changeDeadline(): Date {
    return addDuration(this.state.startsAt, { hours: -INTERVIEW_CHANGE_CUTOFF_HOURS });
  }

  /** Còn ≥ `INTERVIEW_CHANGE_CUTOFF_HOURS` giờ trước giờ bắt đầu (đúng biên vẫn được). */
  canChange(now: Date): boolean {
    return now.getTime() <= this.changeDeadline.getTime();
  }

  /** Người dùng đặt slot: chỉ khi còn trống và chưa tới giờ bắt đầu. */
  book(userId: KycUserId, now: Date): Result<void, InterviewBookError> {
    if (this.state.status !== 'OPEN') return fail('SLOT_TAKEN');
    if (this.state.startsAt.getTime() <= now.getTime()) return fail('INTERVIEW_SLOT_IN_PAST');
    this.state = { ...this.state, status: 'BOOKED', bookedBy: userId, bookedAt: now, updatedAt: now };
    return ok();
  }

  /**
   * Người đã đặt huỷ lịch (cũng là bước đầu của đổi lịch): chỉ khi còn ≥ `INTERVIEW_CHANGE_CUTOFF_HOURS` giờ
   * trước giờ bắt đầu. Slot quay lại `OPEN` cho người khác đặt.
   */
  cancel(userId: KycUserId, now: Date): Result<void, InterviewCancelError> {
    if (this.state.status !== 'BOOKED' || this.state.bookedBy !== userId) return fail('INTERVIEW_NOT_BOOKED');
    if (!this.canChange(now)) {
      return fail('CANCEL_TOO_LATE', { deadline: this.changeDeadline.toISOString() });
    }
    this.state = { ...this.state, status: 'OPEN', bookedBy: null, bookedAt: null, updatedAt: now };
    return ok();
  }

  /**
   * Chuyên viên ghi nhận xét + kết quả sau khi buổi phỏng vấn bắt đầu. Ghi lại lần nữa được phép (đính chính) —
   * use case đồng thời cập nhật bước `INTERVIEW` của hồ sơ.
   */
  recordResult(
    input: { readonly outcome: InterviewOutcome; readonly notes: string; readonly recordedBy: ReviewerId },
    now: Date,
  ): Result<void, InterviewRecordError> {
    if (this.state.status === 'OPEN' || this.state.bookedBy === null) return fail('INTERVIEW_NOT_BOOKED');
    if (now.getTime() < this.state.startsAt.getTime()) return fail('INTERVIEW_NOT_STARTED');
    const notes = input.notes.trim();
    this.state = {
      ...this.state,
      status: 'COMPLETED',
      outcome: input.outcome,
      notes: notes.length > 0 ? notes : null,
      recordedBy: input.recordedBy,
      recordedAt: now,
      updatedAt: now,
    };
    return ok();
  }

  toState(): InterviewSlotState {
    return { ...this.state };
  }
}
