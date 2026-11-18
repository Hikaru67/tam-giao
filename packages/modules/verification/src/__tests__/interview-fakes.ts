import { fail, ok, type Result, type Tx, type UnitOfWork } from '@tamgiao/kernel';
import type {
  InterviewSlotListFilter,
  InterviewSlotRepository,
  InterviewSlotSaveError,
} from '../application/ports/interview-slot-repository.js';
import { InterviewSlot, type InterviewSlotId, type InterviewSlotState } from '../domain/interview-slot.js';
import type { InMemoryKycSubmissionRepository } from './fakes.js';

/** Repository in-memory mô phỏng 2 ràng buộc của DB (1 lịch BOOKED / người; chuyên viên + giờ bắt đầu). */
export class InMemoryInterviewSlotRepository implements InterviewSlotRepository {
  rows = new Map<string, InterviewSlotState>();

  private restore(s: InterviewSlotState | undefined): InterviewSlot | null {
    return s ? InterviewSlot.restore(s) : null;
  }
  async findById(_tx: Tx, id: InterviewSlotId) {
    return this.restore(this.rows.get(id));
  }
  findByIdForUpdate(tx: Tx, id: InterviewSlotId) {
    return this.findById(tx, id);
  }
  async findActiveByUser(_tx: Tx, userId: string) {
    return this.restore([...this.rows.values()].find((r) => r.status === 'BOOKED' && r.bookedBy === userId));
  }
  findActiveByUserForUpdate(tx: Tx, userId: string) {
    return this.findActiveByUser(tx, userId);
  }
  async hasOverlapForUpdate(_tx: Tx, interviewerId: string, startsAt: Date, endsAt: Date) {
    return [...this.rows.values()].some(
      (r) => r.interviewerId === interviewerId && r.startsAt < endsAt && r.endsAt > startsAt,
    );
  }
  async listOpen(_tx: Tx, input: { from: Date; limit: number }) {
    return [...this.rows.values()]
      .filter((r) => r.status === 'OPEN' && r.startsAt > input.from)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, input.limit)
      .map((r) => InterviewSlot.restore(r));
  }
  async list(_tx: Tx, f: InterviewSlotListFilter) {
    return [...this.rows.values()]
      .filter(
        (r) =>
          (f.status === undefined || r.status === f.status) &&
          (f.from === undefined || r.startsAt >= f.from) &&
          (f.to === undefined || r.startsAt < f.to),
      )
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
      .slice(0, f.limit)
      .map((r) => InterviewSlot.restore(r));
  }
  async save(_tx: Tx, slot: InterviewSlot): Promise<Result<void, InterviewSlotSaveError>> {
    const s = slot.toState();
    for (const other of this.rows.values()) {
      if (other.id === s.id) continue;
      if (s.status === 'BOOKED' && other.status === 'BOOKED' && other.bookedBy === s.bookedBy) {
        return fail('INTERVIEW_ALREADY_BOOKED');
      }
      if (other.interviewerId === s.interviewerId && other.startsAt.getTime() === s.startsAt.getTime()) {
        return fail('INTERVIEW_SLOT_OVERLAP');
      }
    }
    this.rows.set(s.id, s);
    return ok();
  }
}

/** `Err`/throw → khôi phục cả 2 repository (mô phỏng rollback). */
export class InterviewFakeUnitOfWork implements UnitOfWork {
  constructor(
    private readonly slots: InMemoryInterviewSlotRepository,
    private readonly submissions: InMemoryKycSubmissionRepository,
  ) {}
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const slotRows = new Map(this.slots.rows);
    const kycRows = new Map(this.submissions.rows);
    const events = [...this.submissions.events];
    const rollback = () => {
      this.slots.rows = slotRows;
      this.submissions.rows = kycRows;
      this.submissions.events = events;
    };
    try {
      const r = await work({} as Tx);
      if (r.isErr()) rollback();
      return r;
    } catch (e) {
      rollback();
      throw e;
    }
  }
}
