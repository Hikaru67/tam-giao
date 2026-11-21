import {
  fail,
  ok,
  type Result,
  type Tx,
  type UnitOfWork,
  type UploadPurpose,
  type UploadRef,
  type UploadRegistry,
  type UploadVerifyError,
} from '@tamgiao/kernel';
import type { MatchBetweenSummary, MatchingFacade } from '@tamgiao/module-matching/facade';
import type { ReportRepository } from '../application/ports/report-repository.js';
import { Report, type ReportId, type ReportState } from '../domain/report.js';

/**
 * UnitOfWork giả: chạy `work`; trả `Err` → khôi phục bản chụp của các repository đăng ký (mô phỏng rollback).
 */
export class SnapshotUnitOfWork implements UnitOfWork {
  runs = 0;
  constructor(private readonly repos: readonly InMemoryReportRepository[] = []) {}

  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    this.runs += 1;
    const snapshots = this.repos.map((r) => r.snapshot());
    const result = await work({} as Tx);
    if (result.isErr()) {
      this.repos.forEach((r, i) => {
        const snapshot = snapshots[i];
        if (snapshot) r.restore(snapshot);
      });
    }
    return result;
  }
}

/** Fake in-memory `ReportRepository` (cùng kiểm tra version lạc quan như adapter Drizzle). */
export class InMemoryReportRepository implements ReportRepository {
  states = new Map<string, ReportState>();
  /** Event đã "ghi" outbox theo thứ tự. */
  outbox: { readonly type: string; readonly payload: unknown }[] = [];

  async save(_tx: Tx, report: Report): Promise<void> {
    const pending = report.pullEvents();
    if (pending.length === 0) return;
    const state = report.toState();
    const previous = state.version - pending.length;
    if ((this.states.get(report.id)?.version ?? 0) !== previous) throw new Error('xung đột version');
    this.states.set(report.id, state);
    for (const e of pending) this.outbox.push({ type: e.type, payload: e.payload });
  }

  async findById(_tx: Tx, id: ReportId): Promise<Report | null> {
    const state = this.states.get(id);
    return state ? Report.restore(state) : null;
  }

  snapshot(): RepoSnapshot {
    return { states: new Map(this.states), outbox: [...this.outbox] };
  }

  restore(snapshot: RepoSnapshot): void {
    this.states = new Map(snapshot.states);
    this.outbox = [...snapshot.outbox];
  }
}

interface RepoSnapshot {
  readonly states: Map<string, ReportState>;
  readonly outbox: InMemoryReportRepository['outbox'];
}

/** `UploadRegistry` giả: key → chủ sở hữu + mục đích. */
export class FakeUploadRegistry implements UploadRegistry {
  readonly uploads = new Map<string, { readonly ownerId: string; readonly purpose: UploadPurpose }>();
  readonly verified: string[] = [];

  add(key: string, ownerId: string, purpose: UploadPurpose = 'report_evidence'): string {
    this.uploads.set(key, { ownerId, purpose });
    return key;
  }

  async verifyOwned(
    _tx: Tx,
    input: { readonly ownerId: string; readonly key: string; readonly purposes: readonly UploadPurpose[] },
  ): Promise<Result<UploadRef, UploadVerifyError>> {
    const upload = this.uploads.get(input.key);
    if (!upload || upload.ownerId !== input.ownerId) return fail('UPLOAD_NOT_OWNED');
    if (!input.purposes.includes(upload.purpose)) return fail('UPLOAD_INVALID', { reason: 'PURPOSE' });
    this.verified.push(input.key);
    return ok({
      uploadId: input.key,
      ownerId: upload.ownerId,
      key: input.key,
      bucket: 'privateKyc',
      purpose: upload.purpose,
      contentType: 'image/jpeg',
      sizeBytes: 1,
    });
  }
}

/** Facade matching giả: cặp (không phân biệt thứ tự) → match gần nhất. */
export class FakeMatchingFacade implements Pick<MatchingFacade, 'findLatestMatchBetween'> {
  readonly pairs = new Map<string, MatchBetweenSummary>();
  calls = 0;

  private static key(a: string, b: string): string {
    return [a.toLowerCase(), b.toLowerCase()].sort().join('|');
  }

  pair(a: string, b: string, summary: MatchBetweenSummary): void {
    this.pairs.set(FakeMatchingFacade.key(a, b), summary);
  }

  async findLatestMatchBetween(a: string, b: string): Promise<MatchBetweenSummary | null> {
    this.calls += 1;
    if (a.toLowerCase() === b.toLowerCase()) return null;
    return this.pairs.get(FakeMatchingFacade.key(a, b)) ?? null;
  }
}
