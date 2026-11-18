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
import type { InterviewSlot } from '../../domain/interview-slot.js';
import type { KycUserId } from '../../domain/kyc-submission.js';
import type { InterviewSlotRepository } from '../ports/interview-slot-repository.js';
import type { KycSubmissionRepository } from '../ports/kyc-submission-repository.js';
import { ensureCanBookInterview } from './interview-eligibility.js';
import { toMyInterviewView, type MyInterviewView } from './interview-views.js';

export interface RescheduleInterviewCommand {
  readonly userId: KycUserId;
  readonly slotId: string;
}

/**
 * Đổi lịch = huỷ lịch cũ (luật `CANCEL_TOO_LATE`) + đặt slot mới trong **cùng transaction**: slot mới không đặt
 * được (`SLOT_TAKEN`…) thì lịch cũ giữ nguyên. Hai slot được khoá theo thứ tự id để tránh deadlock khi hai người
 * đổi chéo lịch của nhau cùng lúc.
 */
export class RescheduleInterview {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly clock: Clock;
      readonly slots: InterviewSlotRepository;
      readonly submissions: KycSubmissionRepository;
    },
  ) {}

  async execute(cmd: RescheduleInterviewCommand): Promise<Result<MyInterviewView, DomainError>> {
    const targetId = parseId<'InterviewSlot'>(cmd.slotId);
    if (targetId.isErr()) return err(targetId.error);

    return this.deps.uow.run(async (tx) => {
      const { slots, submissions } = this.deps;
      const now = this.deps.clock.now();

      const current = await slots.findActiveByUser(tx, cmd.userId);
      if (current === null) return fail('INTERVIEW_NOT_BOOKED');
      if (current.id === targetId.value) return ok(toMyInterviewView(current, now));

      const ids = [current.id, targetId.value].sort();
      const locked = new Map<string, InterviewSlot | null>();
      for (const id of ids) locked.set(id, await slots.findByIdForUpdate(tx, id));
      const old = locked.get(current.id) ?? null;
      const target = locked.get(targetId.value) ?? null;
      // Lịch cũ có thể vừa bị huỷ/đổi bởi request khác của chính người dùng trước khi khoá được.
      if (old === null || old.status !== 'BOOKED' || old.bookedBy !== cmd.userId) {
        return fail('INTERVIEW_NOT_BOOKED');
      }
      if (target === null) return fail('INTERVIEW_SLOT_NOT_FOUND');

      const eligible = await ensureCanBookInterview(submissions, tx, cmd.userId);
      if (eligible.isErr()) return err(eligible.error);

      const cancelled = old.cancel(cmd.userId, now);
      if (cancelled.isErr()) return err(cancelled.error);
      const booked = target.book(cmd.userId, now);
      if (booked.isErr()) return err(booked.error);

      // Lưu lịch cũ trước để partial unique "1 lịch BOOKED / người" không bị vi phạm.
      const savedOld = await slots.save(tx, old);
      if (savedOld.isErr()) return err(savedOld.error);
      const savedNew = await slots.save(tx, target);
      if (savedNew.isErr()) return err(savedNew.error);
      return ok(toMyInterviewView(target, now));
    });
  }
}
