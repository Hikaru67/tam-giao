import {
  err,
  fail,
  newId,
  ok,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import { InterviewSlot } from '../../domain/interview-slot.js';
import type { ReviewerId } from '../../domain/kyc-submission.js';
import type { InterviewSlotRepository } from '../ports/interview-slot-repository.js';
import type { InterviewSlotView } from './interview-views.js';

export interface OpenInterviewSlotCommand {
  readonly interviewerId: ReviewerId;
  readonly startsAt: Date;
  readonly meetingUrl?: string | null;
}

/** Chuyên viên mở một slot phỏng vấn (không chồng giờ với slot khác của chính mình). */
export class OpenInterviewSlot {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly clock: Clock;
      readonly slots: InterviewSlotRepository;
    },
  ) {}

  async execute(cmd: OpenInterviewSlotCommand): Promise<Result<InterviewSlotView, DomainError>> {
    const now = this.deps.clock.now();
    const opened = InterviewSlot.open(
      {
        id: newId<'InterviewSlot'>(),
        interviewerId: cmd.interviewerId,
        startsAt: cmd.startsAt,
        meetingUrl: cmd.meetingUrl ?? null,
      },
      now,
    );
    if (opened.isErr()) return err(opened.error);
    const slot = opened.value;

    return this.deps.uow.run(async (tx) => {
      const { slots } = this.deps;
      if (await slots.hasOverlapForUpdate(tx, cmd.interviewerId, slot.startsAt, slot.endsAt)) {
        return fail('INTERVIEW_SLOT_OVERLAP');
      }
      const saved = await slots.save(tx, slot);
      if (saved.isErr()) return err(saved.error);
      return ok(slot.toState());
    });
  }
}
