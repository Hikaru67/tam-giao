import { fail, ok, type DomainError, type DomainEvent, type Result, type Tx } from '@tamgiao/kernel';
import type { AuditLogger, AuditLogInput } from '@tamgiao/module-identity/facade';
import type {
  AppearanceFlagPage,
  FeedbackAddError,
  FeedbackRepository,
} from '../application/ports/feedback-repository.js';
import { DateFeedback, type DateFeedbackId, type DateFeedbackState } from '../domain/date-feedback.js';

/** Fake in-memory của `FeedbackRepository` (cùng luật unique `(match, author)` như adapter Drizzle). */
export class InMemoryFeedbackRepository implements FeedbackRepository {
  readonly states = new Map<string, DateFeedbackState>();
  readonly events: DomainEvent[] = [];
  readonly lockedMatches: string[] = [];

  async lockMatch(_tx: Tx, matchId: string): Promise<void> {
    this.lockedMatches.push(matchId);
  }

  async add(_tx: Tx, feedback: DateFeedback): Promise<Result<void, FeedbackAddError>> {
    const s = feedback.toState();
    const clash = [...this.states.values()].some((x) => x.matchId === s.matchId && x.authorId === s.authorId);
    if (clash) return fail('FEEDBACK_ALREADY_SUBMITTED', { matchId: s.matchId });
    this.states.set(s.id, s);
    this.events.push(...feedback.pullEvents());
    return ok();
  }

  async findById(_tx: Tx, id: DateFeedbackId): Promise<DateFeedback | null> {
    const s = this.states.get(id);
    return s ? DateFeedback.restore(s) : null;
  }

  async findByMatchAndAuthor(_tx: Tx, matchId: string, authorId: string): Promise<DateFeedback | null> {
    const s = [...this.states.values()].find(
      (x) => x.matchId === matchId.toLowerCase() && x.authorId === authorId.toLowerCase(),
    );
    return s ? DateFeedback.restore(s) : null;
  }

  async listAppearanceFlags(
    _tx: Tx,
    page: { readonly limit: number; readonly offset: number },
  ): Promise<AppearanceFlagPage> {
    const flagged = [...this.states.values()]
      .filter((x) => x.profileMatch === 'DIFFERENT')
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime() || b.id.localeCompare(a.id));
    return {
      total: flagged.length,
      items: flagged.slice(page.offset, page.offset + page.limit).map((x) => ({
        feedbackId: x.id,
        matchId: x.matchId,
        datePlanId: x.datePlanId,
        authorId: x.authorId,
        subjectId: x.subjectId,
        submittedAt: x.submittedAt,
      })),
    };
  }
}

/** AuditLogger ghi nhớ (từ chối mọi bản ghi khi `reject = true`). */
export class RecordingAuditLogger implements AuditLogger {
  readonly entries: AuditLogInput[] = [];
  reject = false;

  log(entry: AuditLogInput): Promise<Result<void, DomainError>>;
  log(tx: Tx, entry: AuditLogInput): Promise<Result<void, DomainError>>;
  async log(first: AuditLogInput | Tx, second?: AuditLogInput): Promise<Result<void, DomainError>> {
    if (this.reject) return fail('AUDIT_ENTRY_INVALID');
    const entry = second ?? (first as AuditLogInput);
    this.entries.push(entry);
    return ok();
  }
}
