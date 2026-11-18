import type {
  InterviewOutcome,
  InterviewSlot,
  InterviewSlotState,
  InterviewSlotStatus,
} from '../../domain/interview-slot.js';

export type { InterviewOutcome, InterviewSlotStatus };

/** Snapshot slot cho chuyên viên (có nhận xét — chỉ trả ở API admin). */
export type InterviewSlotView = InterviewSlotState;

/** Lịch đang hoạt động của người dùng. */
export interface MyInterviewView {
  readonly slotId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly meetingUrl: string | null;
  readonly changeDeadline: Date;
  readonly canChange: boolean;
}

export function toMyInterviewView(slot: InterviewSlot, now: Date): MyInterviewView {
  const s = slot.toState();
  return {
    slotId: s.id,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    meetingUrl: s.meetingUrl,
    changeDeadline: slot.changeDeadline,
    canChange: slot.canChange(now),
  };
}
