import {
  fail,
  ok,
  type DomainEvent,
  type Result,
  type ScheduledJob,
  type Scheduler,
  type Tx,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { BillingPartnerFacade } from '@tamgiao/module-billing/facade';
import type { MatchingFacade, MatchPairStatus, OpenMatchSummary } from '@tamgiao/module-matching/facade';
import type { DatePlanRepository, DatePlanSaveError } from '../application/ports/date-plan-repository.js';
import type {
  CheckInLocationStore,
  SafetyCheckInRepository,
} from '../application/ports/safety-check-in-repository.js';
import { DatePlan, type DatePlanId, type DatePlanState } from '../domain/date-plan.js';
import type { GeoPoint } from '../domain/geo-point.js';
import {
  SafetyCheckIn,
  type AlreadyCheckedIn,
  type SafetyCheckInId,
  type SafetyCheckInState,
} from '../domain/safety-check-in.js';

/** UnitOfWork giả: chạy thẳng `work` (fake repository không có transaction thật). */
export class PassThroughUnitOfWork implements UnitOfWork {
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return work({} as Tx);
  }
}

export class RecordingScheduler implements Scheduler {
  readonly jobs: ScheduledJob[] = [];
  async schedule(_tx: Tx, job: ScheduledJob): Promise<void> {
    this.jobs.push(job);
  }
}

const OPEN = new Set(['PROPOSED', 'CONFIRMED', 'CHECKED_IN']);

/** Fake in-memory của `DatePlanRepository` (cùng luật version lạc quan + "một lịch mở / match" như adapter Drizzle). */
export class InMemoryDatePlanRepository implements DatePlanRepository {
  readonly states = new Map<string, DatePlanState>();
  readonly events: DomainEvent[] = [];

  async save(_tx: Tx, plan: DatePlan): Promise<Result<void, DatePlanSaveError>> {
    const pending = plan.pullEvents();
    if (pending.length === 0) return ok();
    const state = plan.toState();
    const previous = state.version - pending.length;
    const stored = this.states.get(plan.id);
    if (previous === 0) {
      if (stored) throw new Error('duplicate id');
      const clash = [...this.states.values()].some(
        (s) => s.matchId === state.matchId && OPEN.has(s.status) && OPEN.has(state.status),
      );
      if (clash) return fail('DATE_ALREADY_OPEN', { matchId: state.matchId });
    } else if (stored?.version !== previous) {
      throw new Error('version conflict');
    }
    this.states.set(plan.id, state);
    this.events.push(...pending);
    return ok();
  }

  async findById(_tx: Tx, id: DatePlanId): Promise<DatePlan | null> {
    const s = this.states.get(id);
    return s ? DatePlan.restore(s) : null;
  }

  findByIdForUpdate(tx: Tx, id: DatePlanId): Promise<DatePlan | null> {
    return this.findById(tx, id);
  }

  async findOpenByMatch(_tx: Tx, matchId: string): Promise<DatePlan | null> {
    const s = [...this.states.values()].find((x) => x.matchId === matchId && OPEN.has(x.status));
    return s ? DatePlan.restore(s) : null;
  }

  async findLatestByMatch(_tx: Tx, matchId: string): Promise<DatePlan | null> {
    const list = [...this.states.values()]
      .filter((x) => x.matchId === matchId)
      .sort((a, b) => b.proposedAt.getTime() - a.proposedAt.getTime() || b.id.localeCompare(a.id));
    const s = list[0];
    return s ? DatePlan.restore(s) : null;
  }

  async findForVoucherCheckInForUpdate(
    _tx: Tx,
    input: { userId: string; partnerId: string; at: Date },
  ): Promise<DatePlan | null> {
    const userId = input.userId.toLowerCase();
    const s = [...this.states.values()]
      .filter(
        (x) =>
          (x.inviterId === userId || x.inviteeId === userId) &&
          x.partnerId === input.partnerId.toLowerCase() &&
          (x.status === 'CONFIRMED' || x.status === 'CHECKED_IN') &&
          x.startsAt.getTime() <= input.at.getTime() &&
          x.endsAt.getTime() >= input.at.getTime(),
      )
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
    return s ? DatePlan.restore(s) : null;
  }

  eventTypes(): string[] {
    return this.events.map((e) => e.type);
  }
}

/** Fake in-memory của `SafetyCheckInRepository` (unique (lịch, người) + version lạc quan như adapter Drizzle). */
export class InMemorySafetyCheckInRepository implements SafetyCheckInRepository {
  readonly states = new Map<string, SafetyCheckInState>();
  readonly events: DomainEvent[] = [];

  async save(_tx: Tx, checkIn: SafetyCheckIn): Promise<Result<void, AlreadyCheckedIn>> {
    const pending = checkIn.pullEvents();
    if (pending.length === 0) return ok();
    const state = checkIn.toState();
    const previous = state.version - pending.length;
    if (previous === 0) {
      const clash = [...this.states.values()].some(
        (s) => s.datePlanId === state.datePlanId && s.userId === state.userId,
      );
      if (clash) return fail('DATE_ALREADY_CHECKED_IN', { datePlanId: state.datePlanId });
    } else if (this.states.get(checkIn.id)?.version !== previous) {
      throw new Error('version conflict');
    }
    this.states.set(checkIn.id, state);
    this.events.push(...pending);
    return ok();
  }

  async findByPlanAndUser(_tx: Tx, datePlanId: DatePlanId, userId: string): Promise<SafetyCheckIn | null> {
    const id = userId.toLowerCase();
    const s = [...this.states.values()].find((x) => x.datePlanId === datePlanId && x.userId === id);
    return s ? SafetyCheckIn.restore(s) : null;
  }

  findByPlanAndUserForUpdate(tx: Tx, datePlanId: DatePlanId, userId: string): Promise<SafetyCheckIn | null> {
    return this.findByPlanAndUser(tx, datePlanId, userId);
  }

  async findByIdForUpdate(_tx: Tx, id: SafetyCheckInId): Promise<SafetyCheckIn | null> {
    const s = this.states.get(id);
    return s ? SafetyCheckIn.restore(s) : null;
  }

  eventTypes(): string[] {
    return this.events.map((e) => e.type);
  }
}

/** Fake `CheckInLocationStore`: giữ vị trí trong bộ nhớ (test không cần mã hoá). */
export class InMemoryCheckInLocationStore implements CheckInLocationStore {
  readonly rows = new Map<string, { location: GeoPoint; recordedAt: Date; purgeAfter: Date }>();

  async record(
    _tx: Tx,
    input: { checkInId: SafetyCheckInId; location: GeoPoint; recordedAt: Date; purgeAfter: Date },
  ): Promise<void> {
    if (this.rows.has(input.checkInId)) throw new Error('duplicate location');
    const { location, recordedAt, purgeAfter } = input;
    this.rows.set(input.checkInId, { location, recordedAt, purgeAfter });
  }

  async purgeExpired(_tx: Tx, now: Date): Promise<number> {
    let purged = 0;
    for (const [id, row] of this.rows) {
      if (row.purgeAfter.getTime() <= now.getTime()) {
        this.rows.delete(id);
        purged += 1;
      }
    }
    return purged;
  }
}

/** Facade matching giả: match mở theo từng người (cả hai người của cặp trỏ tới cùng match). */
export class FakeMatchingFacade implements Pick<MatchingFacade, 'findOpenMatchForUser'> {
  private readonly byUser = new Map<string, OpenMatchSummary>();

  setMatch(matchId: string, a: string, b: string, status: MatchPairStatus): void {
    const summary: OpenMatchSummary = { matchId, status, participantIds: [a, b] };
    this.byUser.set(a, summary);
    this.byUser.set(b, summary);
  }

  clear(userId: string): void {
    this.byUser.delete(userId);
  }

  async findOpenMatchForUser(userId: string): Promise<OpenMatchSummary | null> {
    return this.byUser.get(userId) ?? null;
  }
}

export class FakePartnerFacade implements Pick<BillingPartnerFacade, 'isActivePartner'> {
  readonly active = new Set<string>();
  async isActivePartner(partnerId: string): Promise<boolean> {
    return this.active.has(partnerId);
  }
}
