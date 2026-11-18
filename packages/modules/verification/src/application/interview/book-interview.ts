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
import type { KycUserId } from '../../domain/kyc-submission.js';
import type { InterviewSlotRepository } from '../ports/interview-slot-repository.js';
import type { KycSubmissionRepository } from '../ports/kyc-submission-repository.js';
import { ensureCanBookInterview } from './interview-eligibility.js';
import { toMyInterviewView, type MyInterviewView } from './interview-views.js';

export interface BookInterviewCommand {
  readonly userId: KycUserId;
  readonly slotId: string;
}

export interface BookInterviewDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly slots: InterviewSlotRepository;
  readonly submissions: KycSubmissionRepository;
}

/**
 * Người dùng đặt một slot. Hai người đặt cùng slot đồng thời → khoá dòng slot (`FOR UPDATE`) cho chạy tuần tự,
 * người sau thấy slot đã `BOOKED` → `SLOT_TAKEN`. Mỗi người tối đa một lịch `BOOKED`: kiểm tra ở đây + partial
 * unique index ở DB (`INTERVIEW_ALREADY_BOOKED`, kể cả khi cùng người đặt 2 slot đồng thời).
 */
export class BookInterview {
  constructor(private readonly deps: BookInterviewDeps) {}

  async execute(cmd: BookInterviewCommand): Promise<Result<MyInterviewView, DomainError>> {
    const slotId = parseId<'InterviewSlot'>(cmd.slotId);
    if (slotId.isErr()) return err(slotId.error);

    return this.deps.uow.run(async (tx) => {
      const { slots, submissions } = this.deps;
      const now = this.deps.clock.now();

      const eligible = await ensureCanBookInterview(submissions, tx, cmd.userId);
      if (eligible.isErr()) return err(eligible.error);

      const active = await slots.findActiveByUser(tx, cmd.userId);
      if (active !== null) return fail('INTERVIEW_ALREADY_BOOKED', { slotId: active.id });

      const slot = await slots.findByIdForUpdate(tx, slotId.value);
      if (slot === null) return fail('INTERVIEW_SLOT_NOT_FOUND');
      const booked = slot.book(cmd.userId, now);
      if (booked.isErr()) return err(booked.error);

      const saved = await slots.save(tx, slot);
      if (saved.isErr()) return err(saved.error);
      return ok(toMyInterviewView(slot, now));
    });
  }
}
