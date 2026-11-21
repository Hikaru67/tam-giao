import { OutboxWriter } from '@tamgiao/db';
import type { AppEnv, RequireAdmin } from '@tamgiao/http';
import type { Clock, ObjectStorage, UnitOfWork, UploadRegistry } from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { MatchingFacade } from '@tamgiao/module-matching/facade';
import type { MessagingFacade } from '@tamgiao/module-messaging/facade';
import { Hono, type MiddlewareHandler } from 'hono';
import { BanUser } from './application/admin/ban-user.js';
import { GetFlaggedMessage, ListFlaggedMessages } from './application/admin/flagged-messages.js';
import { GetReportDetail } from './application/admin/get-report-detail.js';
import { GetReportQueue } from './application/admin/get-report-queue.js';
import { ResolveReport, StartReportReview } from './application/admin/report-actions.js';
import { FileReport } from './application/file-report.js';
import { DrizzleReportQueue } from './infrastructure/drizzle-report-queue.js';
import { DrizzleReportRepository } from './infrastructure/drizzle-report-repository.js';
import { DrizzleUserBanRepository } from './infrastructure/drizzle-user-ban-repository.js';
import { createModerationAdminRoutes } from './presentation/moderation-admin-routes.js';
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
export type { BanUser, BanUserCommand, BanUserError, UserBanView } from './application/admin/ban-user.js';
export type { ReportOutcome, ResolveReport, StartReportReview } from './application/admin/report-actions.js';
export { SAFETY_AUDIT_ACTION, SAFETY_AUDIT_TARGET } from './application/admin/moderation-audit.js';

export interface SafetyModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  /** Xác nhận key ảnh bằng chứng thuộc người báo cáo (BE-S2-07, mục đích `report_evidence`). */
  readonly uploads: UploadRegistry;
  /** Facade matching (`matching.facade`) — luật "chỉ báo cáo người đang/đã từng ghép". */
  readonly matching: Pick<MatchingFacade, 'findLatestMatchBetween'>;
  /** Guard người dùng app — `requireUser(identity.facade.authenticateUser)`. */
  readonly requireUser: MiddlewareHandler<AppEnv>;
  /** Guard admin — route kiểm duyệt (BE-S6-06) dùng `requireAdmin('safety:ban')`. */
  readonly requireAdmin: RequireAdmin;
  /** Ghi audit mỗi lần xem chi tiết báo cáo / tin gắn cờ và mỗi thao tác xử lý / khoá (BE-S6-06). */
  readonly auditLogger: AuditLogger;
  /** Presigned GET ảnh bằng chứng (bucket private) cho chi tiết báo cáo. */
  readonly storage: ObjectStorage;
  /** Facade messaging (`messaging.facade`) — hàng chờ tin bị gắn cờ (A3: không đọc bảng messaging). */
  readonly messaging: MessagingFacade;
}

export interface SafetyModule {
  readonly name: 'safety';
  /**
   * Route BE-S6-05: `POST /me/reports`. BE-S6-06 (admin, `safety:ban`): `GET /admin/reports`, `GET /admin/reports/:id`,
   * `POST /admin/reports/:id/start-review|resolve`, `GET /admin/flagged-messages[/:id]`, `POST /admin/users/:id/ban`.
   */
  readonly routes: Hono<AppEnv>;
  readonly commands: {
    readonly fileReport: FileReport;
    readonly startReportReview: StartReportReview;
    readonly resolveReport: ResolveReport;
    readonly banUser: BanUser;
  };
}

/** Composition root phía API của module safety. */
export function createSafetyModule(deps: SafetyModuleDeps): SafetyModule {
  const { uow, clock, auditLogger } = deps;
  const reports = new DrizzleReportRepository(new OutboxWriter());
  const fileReport = new FileReport({ uow, clock, reports, uploads: deps.uploads, matching: deps.matching });
  const actionDeps = { uow, clock, reports, auditLogger };
  const commands = {
    fileReport,
    startReportReview: new StartReportReview(actionDeps),
    resolveReport: new ResolveReport(actionDeps),
    banUser: new BanUser({
      uow,
      clock,
      reports,
      auditLogger,
      bans: new DrizzleUserBanRepository(new OutboxWriter()),
    }),
  };

  const routes = new Hono<AppEnv>();
  routes.route('/', createReportRoutes({ fileReport, requireUser: deps.requireUser }));
  routes.route(
    '/',
    createModerationAdminRoutes({
      getReportQueue: new GetReportQueue({ uow, clock, queue: new DrizzleReportQueue() }),
      getReportDetail: new GetReportDetail({ uow, clock, reports, auditLogger, storage: deps.storage }),
      startReportReview: commands.startReportReview,
      resolveReport: commands.resolveReport,
      listFlaggedMessages: new ListFlaggedMessages({ messaging: deps.messaging }),
      getFlaggedMessage: new GetFlaggedMessage({ messaging: deps.messaging, auditLogger }),
      banUser: commands.banUser,
      requireAdmin: deps.requireAdmin,
    }),
  );
  return { name: 'safety', routes, commands };
}
