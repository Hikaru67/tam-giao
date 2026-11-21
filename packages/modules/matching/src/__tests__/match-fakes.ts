import {
  fail,
  ok,
  type DomainError,
  type Result,
  type ScheduledJob,
  type Scheduler,
  type Tx,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { AuditLogger, AuditLogInput } from '@tamgiao/module-identity/facade';
import type { VerificationFacade } from '@tamgiao/module-verification/facade';
import type { CandidateProfileReader } from '../application/ports/candidate-profile-reader.js';
import type { MatchRepository } from '../application/ports/match-repository.js';
import type { CandidateProfile } from '../domain/candidate-profile.js';
import { Match, type MatchId, type MatchState } from '../domain/match.js';

/** UnitOfWork giả: chạy thẳng `work` (fake repository không có transaction thật). */
export class PassThroughUnitOfWork implements UnitOfWork {
  runs = 0;
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    this.runs += 1;
    return work({} as Tx);
  }
}

/** Fake in-memory của `MatchRepository` (cùng kiểm tra version lạc quan như adapter Drizzle). */
export class InMemoryMatchRepository implements MatchRepository {
  readonly states = new Map<string, MatchState>();
  /** Event đã "ghi" (match_events + outbox) theo thứ tự. */
  readonly events: { readonly type: string; readonly aggregateId: string; readonly version: number }[] = [];

  async save(_tx: Tx, match: Match): Promise<void> {
    const pending = match.pullEvents();
    if (pending.length === 0) return;
    const state = match.toState();
    const previous = state.version - pending.length;
    const stored = this.states.get(match.id);
    if ((stored?.version ?? 0) !== previous) throw new Error(`xung đột version ${match.id}`);
    this.states.set(match.id, state);
    for (const e of pending)
      this.events.push({ type: e.type, aggregateId: e.aggregateId, version: e.version });
  }

  async findById(_tx: Tx, id: MatchId): Promise<Match | null> {
    const state = this.states.get(id);
    return state ? Match.restore(state) : null;
  }

  findByIdForUpdate(tx: Tx, id: MatchId): Promise<Match | null> {
    return this.findById(tx, id);
  }

  async findOpenByUser(_tx: Tx, userId: string): Promise<Match | null> {
    for (const state of this.states.values()) {
      const match = Match.restore(state);
      if (match.isOpen() && match.isParticipant(userId)) return match;
    }
    return null;
  }
}

export class RecordingScheduler implements Scheduler {
  readonly jobs: ScheduledJob[] = [];
  async schedule(_tx: Tx, job: ScheduledJob): Promise<void> {
    this.jobs.push(job);
  }
}

export class FakeVerification implements Pick<VerificationFacade, 'isVerified'> {
  readonly verified = new Set<string>();
  async isVerified(userId: string): Promise<boolean> {
    return this.verified.has(userId);
  }
}

export class InMemoryCandidateProfileReader implements CandidateProfileReader {
  readonly profiles = new Map<string, CandidateProfile>();
  async findSynced(_tx: Tx, userIds: readonly string[]): Promise<ReadonlyMap<string, CandidateProfile>> {
    const found = new Map<string, CandidateProfile>();
    for (const id of userIds) {
      const profile = this.profiles.get(id);
      if (profile) found.set(id, profile);
    }
    return found;
  }
}

export class RecordingAuditLogger implements AuditLogger {
  readonly entries: AuditLogInput[] = [];
  failWith: string | null = null;
  log(entry: AuditLogInput): Promise<Result<void, DomainError>>;
  log(tx: Tx, entry: AuditLogInput): Promise<Result<void, DomainError>>;
  async log(a: Tx | AuditLogInput, b?: AuditLogInput): Promise<Result<void, DomainError>> {
    if (this.failWith !== null) return fail(this.failWith);
    this.entries.push(b ?? (a as AuditLogInput));
    return ok();
  }
}
