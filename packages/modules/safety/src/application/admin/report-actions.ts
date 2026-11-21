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
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { ReportCloseError, ReportStatus, ReportTransitionError } from '../../domain/report.js';
import type { ReportRepository } from '../ports/report-repository.js';
import {
  SAFETY_AUDIT_ACTION,
  SAFETY_AUDIT_TARGET,
  auditModeration,
  type ModerationActor,
} from './moderation-audit.js';

export interface ReportActionDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly reports: ReportRepository;
  readonly auditLogger: AuditLogger;
}

/** Kết quả thao tác xử lý báo cáo. */
export interface ReportActionView {
  readonly reportId: string;
  readonly status: ReportStatus;
  readonly handledBy: string | null;
  readonly closedAt: Date | null;
  readonly updatedAt: Date;
}

type NotFound = DomainError<'REPORT_NOT_FOUND'>;

/** Kết luận đóng báo cáo: `RESOLVED` = có vi phạm, `DISMISSED` = bác bỏ. */
export type ReportOutcome = 'RESOLVED' | 'DISMISSED';

export interface ResolveReportCommand {
  readonly reportId: string;
  readonly outcome: ReportOutcome;
  /** Kết luận bắt buộc — văn bản tự do (PII), không log/audit. */
  readonly conclusion: string;
  readonly actor: ModerationActor;
}

/**
 * Chuyên viên nhận xử lý báo cáo (OPEN → IN_REVIEW, BE-S6-06). Một transaction: tải → domain → lưu
 * (+ `ReportStatusChanged` vào outbox) → audit `safety.report.start_review`. Trạng thái khác `OPEN` →
 * `REPORT_INVALID_TRANSITION`.
 */
export class StartReportReview {
  constructor(private readonly deps: ReportActionDeps) {}

  async execute(cmd: {
    readonly reportId: string;
    readonly actor: ModerationActor;
  }): Promise<Result<ReportActionView, NotFound | ReportTransitionError>> {
    return runReportAction(
      this.deps,
      cmd.reportId,
      cmd.actor,
      SAFETY_AUDIT_ACTION.startReview,
      (report, now) => report.startReview(now, cmd.actor.adminId),
    );
  }
}

/**
 * Ghi kết luận và đóng báo cáo (BE-S6-06): `RESOLVED` (báo cáo `OPEN` được tự nhận xử lý trước — phát hai
 * `ReportStatusChanged`: OPEN → IN_REVIEW → RESOLVED) hoặc `DISMISSED`. Kết luận trim rỗng / quá dài →
 * `REPORT_CONCLUSION_INVALID`; báo cáo đã đóng → `REPORT_INVALID_TRANSITION`. Audit `safety.report.close`
 * (`meta.outcome`, không kèm kết luận) cùng transaction. Không tự khoá người bị báo cáo — dùng `BanUser`.
 */
export class ResolveReport {
  constructor(private readonly deps: ReportActionDeps) {}

  async execute(cmd: ResolveReportCommand): Promise<Result<ReportActionView, NotFound | ReportCloseError>> {
    const input = { staffId: cmd.actor.adminId, conclusion: cmd.conclusion };
    return runReportAction(
      this.deps,
      cmd.reportId,
      cmd.actor,
      SAFETY_AUDIT_ACTION.closeReport,
      (report, now) => {
        if (cmd.outcome === 'DISMISSED') return report.dismiss(now, input);
        if (report.status === 'OPEN') {
          const started = report.startReview(now, cmd.actor.adminId);
          if (started.isErr()) return err(started.error);
        }
        return report.resolve(now, input);
      },
      { outcome: cmd.outcome },
    );
  }
}

async function runReportAction<E extends DomainError>(
  deps: ReportActionDeps,
  rawId: string,
  actor: ModerationActor,
  action: string,
  apply: (
    report: NonNullable<Awaited<ReturnType<ReportRepository['findById']>>>,
    now: Date,
  ) => Result<void, E>,
  meta: Readonly<Record<string, unknown>> = {},
): Promise<Result<ReportActionView, NotFound | E>> {
  const id = parseId<'Report'>(rawId);
  if (id.isErr()) return fail('REPORT_NOT_FOUND');
  return deps.uow.run(async (tx): Promise<Result<ReportActionView, NotFound | E>> => {
    const report = await deps.reports.findById(tx, id.value);
    if (report === null) return fail('REPORT_NOT_FOUND');
    const fromStatus = report.status;
    const applied = apply(report, deps.clock.now());
    if (applied.isErr()) return err(applied.error);
    await deps.reports.save(tx, report);
    const s = report.toState();
    await auditModeration(deps.auditLogger, tx, actor, {
      action,
      targetType: SAFETY_AUDIT_TARGET.report,
      targetId: s.id,
      meta: { ...meta, fromStatus, toStatus: s.status },
    });
    return ok({
      reportId: s.id,
      status: s.status,
      handledBy: s.handledBy,
      closedAt: s.closedAt,
      updatedAt: s.updatedAt,
    });
  });
}
