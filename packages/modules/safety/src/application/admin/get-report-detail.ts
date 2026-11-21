import {
  fail,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type ObjectStorage,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { ReportState } from '../../domain/report.js';
import type { ReportRepository } from '../ports/report-repository.js';
import {
  SAFETY_AUDIT_ACTION,
  SAFETY_AUDIT_TARGET,
  auditModeration,
  type ModerationActor,
} from './moderation-audit.js';

export interface PresignedEvidence {
  readonly key: string;
  readonly url: string;
  readonly expiresAt: Date;
}

/** Chi tiết báo cáo cho chuyên viên. **Chứa PII** (mô tả, link ảnh bằng chứng, kết luận) — không log. */
export interface ReportDetailView extends Omit<ReportState, 'evidenceKeys'> {
  /** Presigned GET bucket private (TTL `PRESIGNED_URL_TTL_SECONDS` của adapter). */
  readonly evidence: readonly PresignedEvidence[];
  readonly overdue: boolean;
}

export interface GetReportDetailDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly reports: ReportRepository;
  readonly auditLogger: AuditLogger;
  readonly storage: ObjectStorage;
}

/**
 * Panel chi tiết báo cáo (BE-S6-06, AC2): **mỗi lần mở ghi 1 bản ghi audit** `safety.report.view_detail` trong cùng
 * transaction với lần đọc — audit lỗi thì không trả dữ liệu. Id sai dạng / không có → `REPORT_NOT_FOUND`.
 */
export class GetReportDetail {
  constructor(private readonly deps: GetReportDetailDeps) {}

  async execute(query: {
    readonly reportId: string;
    readonly actor: ModerationActor;
  }): Promise<Result<ReportDetailView, DomainError<'REPORT_NOT_FOUND'>>> {
    const id = parseId<'Report'>(query.reportId);
    if (id.isErr()) return fail('REPORT_NOT_FOUND');

    const found = await this.deps.uow.run(
      async (tx): Promise<Result<ReportState, DomainError<'REPORT_NOT_FOUND'>>> => {
        const report = await this.deps.reports.findById(tx, id.value);
        if (report === null) return fail('REPORT_NOT_FOUND');
        const s = report.toState();
        await auditModeration(this.deps.auditLogger, tx, query.actor, {
          action: SAFETY_AUDIT_ACTION.viewReport,
          targetType: SAFETY_AUDIT_TARGET.report,
          targetId: s.id,
          meta: { status: s.status, reportedUserId: s.reportedUserId },
        });
        return ok(s);
      },
    );
    if (found.isErr()) return fail(found.error.code);
    const { evidenceKeys, ...s } = found.value;

    const evidence = await Promise.all(
      evidenceKeys.map(async (key) => {
        const signed = await this.deps.storage.presignGet({ bucket: 'privateKyc', key });
        return { key, url: signed.url, expiresAt: signed.expiresAt };
      }),
    );
    const now = this.deps.clock.now();
    const open = s.status === 'OPEN' || s.status === 'IN_REVIEW';
    return ok({ ...s, evidence, overdue: open && s.dueAt !== null && s.dueAt.getTime() <= now.getTime() });
  }
}
