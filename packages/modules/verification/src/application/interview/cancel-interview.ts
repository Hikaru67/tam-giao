import { err, fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { KycUserId } from '../../domain/kyc-submission.js';
import type { InterviewSlotRepository } from '../ports/interview-slot-repository.js';

/**
 * Người dùng huỷ lịch đang hoạt động — chỉ khi còn ≥ `INTERVIEW_CHANGE_CUTOFF_HOURS` giờ trước giờ bắt đầu
 * (`CANCEL_TOO_LATE`). Slot được trả lại cho người khác đặt.
 */
export class CancelInterview {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly clock: Clock;
      readonly slots: InterviewSlotRepository;
    },
  ) {}

  async execute(cmd: { readonly userId: KycUserId }): Promise<Result<void, DomainError>> {
    return this.deps.uow.run(async (tx) => {
      const { slots } = this.deps;
      const active = await slots.findActiveByUserForUpdate(tx, cmd.userId);
      if (active === null) return fail('INTERVIEW_NOT_BOOKED');
      const cancelled = active.cancel(cmd.userId, this.deps.clock.now());
      if (cancelled.isErr()) return err(cancelled.error);
      const saved = await slots.save(tx, active);
      if (saved.isErr()) return err(saved.error);
      return ok();
    });
  }
}
