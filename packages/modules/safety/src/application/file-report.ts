import {
  fail,
  newId,
  ok,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
  type UploadRegistry,
  type UploadVerifyError,
} from '@tamgiao/kernel';
import type { MatchingFacade } from '@tamgiao/module-matching/facade';
import {
  Report,
  type ReportCategory,
  type ReportFileError,
  type ReportId,
  type ReportSeverity,
  type ReportStatus,
} from '../domain/report.js';
import type { ReportRepository } from './ports/report-repository.js';

export interface FileReportDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly reports: ReportRepository;
  /** Xác nhận key ảnh bằng chứng thuộc người báo cáo (BE-S2-07). */
  readonly uploads: UploadRegistry;
  /** Facade matching — match gần nhất giữa hai người (luật "đang/đã từng ghép"). */
  readonly matching: Pick<MatchingFacade, 'findLatestMatchBetween'>;
}

export interface FileReportCommand {
  readonly reporterId: string;
  readonly reportedUserId: string;
  readonly category: ReportCategory;
  /** Văn bản tự do — có thể chứa PII, không log. */
  readonly description?: string | null;
  readonly evidenceKeys?: readonly string[];
  /** "Chuyên viên can thiệp khẩn cấp". */
  readonly urgentIntervention?: boolean;
}

export interface FiledReportView {
  readonly reportId: ReportId;
  readonly status: ReportStatus;
  readonly category: ReportCategory;
  readonly severity: ReportSeverity;
  readonly urgent: boolean;
  readonly dueAt: Date | null;
  readonly createdAt: Date;
}

export type FileReportError = ReportFileError | UploadVerifyError | DomainError<'REPORT_TARGET_INVALID'>;

/**
 * Người dùng gửi báo cáo vi phạm (`POST /me/reports`, BE-S6-05). Thứ tự:
 * 1. Facade matching `findLatestMatchBetween` (transaction riêng, chỉ đọc): tự báo cáo → `REPORT_TARGET_INVALID
 *    {SELF}`; chưa từng được ghép với người này → `REPORT_TARGET_INVALID {NEVER_MATCHED}` (AC2). Không phân biệt
 *    "người không tồn tại" để không lộ thông tin.
 * 2. Domain `Report.file` (mô tả / số bằng chứng quá giới hạn).
 * 3. **Một transaction**: mỗi key bằng chứng `uploads.verifyOwned(report_evidence)` — key của người khác →
 *    `UPLOAD_NOT_OWNED`, sai mục đích/chưa tải lên → `UPLOAD_INVALID` (AC3; `meta.index`), lỗi → rollback; rồi
 *    `reports.save` (+ `ReportFiled` vào outbox cùng `tx`, A6).
 * Khoá match + đóng hội thoại diễn ra bất đồng bộ qua consumer `ReportFiled` (matching `LockMatch`, messaging).
 */
export class FileReport {
  constructor(private readonly deps: FileReportDeps) {}

  async execute(cmd: FileReportCommand): Promise<Result<FiledReportView, FileReportError>> {
    const latest = await this.deps.matching.findLatestMatchBetween(cmd.reporterId, cmd.reportedUserId);
    if (latest === null) {
      const self = cmd.reporterId.toLowerCase() === cmd.reportedUserId.toLowerCase();
      return fail('REPORT_TARGET_INVALID', { reason: self ? 'SELF' : 'NEVER_MATCHED' });
    }

    const filed = Report.file(
      {
        id: newId<'Report'>(),
        reporterId: cmd.reporterId,
        reportedUserId: cmd.reportedUserId,
        matchId: latest.matchId,
        category: cmd.category,
        description: cmd.description ?? null,
        evidenceKeys: cmd.evidenceKeys ?? [],
        urgent: cmd.urgentIntervention ?? false,
      },
      this.deps.clock.now(),
    );
    if (filed.isErr()) return fail(filed.error.code, filed.error.details);
    const report = filed.value;
    const { evidenceKeys } = report.toState();

    return this.deps.uow.run(async (tx): Promise<Result<FiledReportView, FileReportError>> => {
      for (const [index, key] of evidenceKeys.entries()) {
        const owned = await this.deps.uploads.verifyOwned(tx, {
          ownerId: cmd.reporterId,
          key,
          purposes: ['report_evidence'],
        });
        if (owned.isErr()) return fail(owned.error.code, { ...owned.error.details, index });
      }
      await this.deps.reports.save(tx, report);
      return ok({
        reportId: report.id,
        status: report.status,
        category: report.category,
        severity: report.severity,
        urgent: report.urgent,
        dueAt: report.dueAt,
        createdAt: report.createdAt,
      });
    });
  }
}
