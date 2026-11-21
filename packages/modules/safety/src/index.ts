import { OutboxWriter } from '@tamgiao/db';
import type { AppEnv } from '@tamgiao/http';
import type { Clock, UnitOfWork, UploadRegistry } from '@tamgiao/kernel';
import type { MatchingFacade } from '@tamgiao/module-matching/facade';
import type { Hono, MiddlewareHandler } from 'hono';
import { FileReport } from './application/file-report.js';
import { DrizzleReportRepository } from './infrastructure/drizzle-report-repository.js';
import { createReportRoutes } from './presentation/report-routes.js';

/**
 * Module safety (Sprint 6): báo cáo vi phạm + khoá 2 chiều (BE-S6-05), kiểm duyệt admin (BE-S6-06).
 * Khoá match khi có báo cáo do matching xử lý (consumer `ReportFiled`), đóng hội thoại do messaging xử lý (`MatchLocked`).
 */
export type {
  FileReport,
  FileReportCommand,
  FileReportError,
  FiledReportView,
} from './application/file-report.js';
export {
  REPORT_CATEGORIES,
  REPORT_SEVERITIES,
  REPORT_SEVERITY_BY_CATEGORY,
  REPORT_STATUSES,
  type ReportCategory,
  type ReportSeverity,
  type ReportStatus,
} from './domain/report.js';

export interface SafetyModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  /** Xác nhận key ảnh bằng chứng thuộc người báo cáo (BE-S2-07, mục đích `report_evidence`). */
  readonly uploads: UploadRegistry;
  /** Facade matching (`matching.facade`) — luật "chỉ báo cáo người đang/đã từng ghép". */
  readonly matching: Pick<MatchingFacade, 'findLatestMatchBetween'>;
  /** Guard người dùng app — `requireUser(identity.facade.authenticateUser)`. */
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

export interface SafetyModule {
  readonly name: 'safety';
  /** Route BE-S6-05: `POST /me/reports`. */
  readonly routes: Hono<AppEnv>;
  readonly commands: { readonly fileReport: FileReport };
}

/** Composition root phía API của module safety. */
export function createSafetyModule(deps: SafetyModuleDeps): SafetyModule {
  const fileReport = new FileReport({
    uow: deps.uow,
    clock: deps.clock,
    reports: new DrizzleReportRepository(new OutboxWriter()),
    uploads: deps.uploads,
    matching: deps.matching,
  });
  const routes = createReportRoutes({ fileReport, requireUser: deps.requireUser });
  return { name: 'safety', routes, commands: { fileReport } };
}
