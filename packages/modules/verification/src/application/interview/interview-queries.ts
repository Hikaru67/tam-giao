import { ok, type Clock, type UnitOfWork } from '@tamgiao/kernel';
import type { KycUserId } from '../../domain/kyc-submission.js';
import type { InterviewSlotListFilter, InterviewSlotRepository } from '../ports/interview-slot-repository.js';
import { toMyInterviewView, type InterviewSlotView, type MyInterviewView } from './interview-views.js';

interface QueryDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly slots: InterviewSlotRepository;
}

/** Slot còn trống cho người dùng chọn: bắt đầu sau `max(from, bây giờ)`. */
export class ListAvailableInterviewSlots {
  constructor(private readonly deps: QueryDeps) {}

  async execute(input: {
    readonly from?: Date;
    readonly limit: number;
  }): Promise<readonly { readonly id: string; readonly startsAt: Date; readonly endsAt: Date }[]> {
    const now = this.deps.clock.now();
    const from = input.from !== undefined && input.from > now ? input.from : now;
    const result = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.slots.listOpen(tx, { from, limit: input.limit })),
    );
    return result.unwrapOr([]).map((slot) => ({ id: slot.id, startsAt: slot.startsAt, endsAt: slot.endsAt }));
  }
}

/** Lịch đang hoạt động của chính người dùng (`null` khi chưa đặt). */
export class GetMyInterview {
  constructor(private readonly deps: QueryDeps) {}

  async execute(userId: KycUserId): Promise<MyInterviewView | null> {
    const result = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.slots.findActiveByUser(tx, userId)),
    );
    const slot = result.unwrapOr(null);
    return slot === null ? null : toMyInterviewView(slot, this.deps.clock.now());
  }
}

/** Nhật ký phỏng vấn cho chuyên viên (gồm nhận xét + kết quả). */
export class ListInterviewSlots {
  constructor(private readonly deps: Omit<QueryDeps, 'clock'>) {}

  async execute(filter: InterviewSlotListFilter): Promise<readonly InterviewSlotView[]> {
    const result = await this.deps.uow.run(async (tx) => ok(await this.deps.slots.list(tx, filter)));
    return result.unwrapOr([]).map((slot) => slot.toState());
  }
}
