import {
  err,
  fail,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { InterviewOutcome } from '../../domain/interview-slot.js';
import type { ReviewerId } from '../../domain/kyc-submission.js';
import type { InterviewSlotRepository } from '../ports/interview-slot-repository.js';
import type { KycSubmissionRepository } from '../ports/kyc-submission-repository.js';
import type { InterviewSlotView } from './interview-views.js';

export interface RecordInterviewResultCommand {
  readonly slotId: string;
  readonly reviewerId: ReviewerId;
  readonly outcome: InterviewOutcome;
  /** Nhận xét — có thể chứa thông tin cá nhân: không log, không đưa vào event. */
  readonly notes: string;
}

/**
 * Chuyên viên ghi nhận xét + kết quả phỏng vấn và cập nhật bước `INTERVIEW` của hồ sơ trong **cùng transaction**
 * (AC2). Hồ sơ đã quyết định → `KYC_ALREADY_DECIDED`, không ghi gì.
 */
export class RecordInterviewResult {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly clock: Clock;
      readonly slots: InterviewSlotRepository;
      readonly submissions: KycSubmissionRepository;
    },
  ) {}

  async execute(cmd: RecordInterviewResultCommand): Promise<Result<InterviewSlotView, DomainError>> {
    const slotId = parseId<'InterviewSlot'>(cmd.slotId);
    if (slotId.isErr()) return fail('INTERVIEW_SLOT_NOT_FOUND');

    return this.deps.uow.run(async (tx) => {
      const { slots, submissions } = this.deps;
      const now = this.deps.clock.now();

      const slot = await slots.findByIdForUpdate(tx, slotId.value);
      if (slot === null) return fail('INTERVIEW_SLOT_NOT_FOUND');
      const recorded = slot.recordResult(
        { outcome: cmd.outcome, notes: cmd.notes, recordedBy: cmd.reviewerId },
        now,
      );
      if (recorded.isErr()) return err(recorded.error);

      const userId = slot.bookedBy;
      const submission = userId === null ? null : await submissions.findByUserIdForUpdate(tx, userId);
      if (submission === null) return fail('INTERVIEW_REQUIRES_SUBMISSION', { status: 'NOT_SUBMITTED' });
      const marked = submission.markStep('INTERVIEW', cmd.outcome, now);
      if (marked.isErr()) return err(marked.error);

      const savedSlot = await slots.save(tx, slot);
      if (savedSlot.isErr()) return err(savedSlot.error);
      const savedSubmission = await submissions.save(tx, submission);
      if (savedSubmission.isErr()) return err(savedSubmission.error);
      return ok(slot.toState());
    });
  }
}
