import {
  banUserBodySchema,
  flaggedMessageQueueQuerySchema,
  reportQueueQuerySchema,
  resolveReportBodySchema,
  type BanUserResponse,
  type FlaggedMessageDetailResponse,
  type FlaggedMessageQueueResponse,
  type ReportActionResponse,
  type ReportDetailResponse,
  type ReportQueueResponse,
} from '@tamgiao/contracts';
import {
  parseBody,
  parseQuery,
  problemResponse,
  sendResult,
  type AppEnv,
  type RequireAdmin,
} from '@tamgiao/http';
import { domainError } from '@tamgiao/kernel';
import { Hono, type Context } from 'hono';
import type { BanUser } from '../application/admin/ban-user.js';
import type {
  FlaggedMessageCursor,
  FlaggedMessageSummary,
  GetFlaggedMessage,
  ListFlaggedMessages,
} from '../application/admin/flagged-messages.js';
import type { GetReportDetail } from '../application/admin/get-report-detail.js';
import type { GetReportQueue } from '../application/admin/get-report-queue.js';
import type { ModerationActor } from '../application/admin/moderation-audit.js';
import type {
  ReportActionView,
  ResolveReport,
  StartReportReview,
} from '../application/admin/report-actions.js';

export interface ModerationAdminRoutesDeps {
  readonly getReportQueue: GetReportQueue;
  readonly getReportDetail: GetReportDetail;
  readonly startReportReview: StartReportReview;
  readonly resolveReport: ResolveReport;
  readonly listFlaggedMessages: ListFlaggedMessages;
  readonly getFlaggedMessage: GetFlaggedMessage;
  readonly banUser: BanUser;
  readonly requireAdmin: RequireAdmin;
}

/**
 * Mọi route kiểm duyệt dùng `safety:ban` (role `SUPERVISOR`/`ADMIN`): xem báo cáo/tin gắn cờ là bước trước quyết định
 * khoá, cùng một nhóm chuyên viên — không thêm permission đọc riêng.
 */
const SAFETY_PERMISSION = 'safety:ban';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cursor mờ cho client: base64url của `<sentAt ISO>|<messageId>`. */
const encodeCursor = (c: FlaggedMessageCursor): string =>
  Buffer.from(`${c.sentAt.toISOString()}|${c.messageId}`, 'utf8').toString('base64url');

function decodeCursor(raw: string): FlaggedMessageCursor | null {
  const [iso, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (iso === undefined || id === undefined || rest.length > 0 || !UUID_PATTERN.test(id)) return null;
  const sentAt = new Date(iso);
  return Number.isNaN(sentAt.getTime()) ? null : { sentAt, messageId: id };
}

const actorOf = (c: Context<AppEnv>): ModerationActor => {
  const ip = c.get('clientIp');
  return { adminId: c.get('admin').adminId, ip: ip === 'unknown' ? null : ip };
};

const toActionResponse = (v: ReportActionView): ReportActionResponse => ({
  reportId: v.reportId,
  status: v.status,
  handledBy: v.handledBy,
  closedAt: v.closedAt?.toISOString() ?? null,
  updatedAt: v.updatedAt.toISOString(),
});

const toFlaggedSummary = (m: FlaggedMessageSummary): FlaggedMessageQueueResponse['items'][number] => ({
  messageId: m.messageId,
  conversationId: m.conversationId,
  matchId: m.matchId,
  senderId: m.senderId,
  recipientId: m.recipientId,
  reasons: [...m.reasons],
  sentAt: m.sentAt.toISOString(),
});

/**
 * Route admin "Báo cáo Vi phạm & Khiếu nại" + "Cảnh báo vi phạm" (BE-S6-06): `GET /admin/reports`,
 * `GET /admin/reports/:id`, `POST /admin/reports/:id/start-review`, `POST /admin/reports/:id/resolve`,
 * `GET /admin/flagged-messages`, `GET /admin/flagged-messages/:id`, `POST /admin/users/:id/ban`.
 * Body/response chứa PII (mô tả, kết luận, lý do khoá, nội dung tin) — không log.
 */
export function createModerationAdminRoutes(deps: ModerationAdminRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const admin = deps.requireAdmin(SAFETY_PERMISSION);

  routes.get('/admin/reports', admin, async (c) => {
    const query = parseQuery(c, reportQueueQuerySchema);
    if (query.isErr()) return query.error;
    const { status, limit, offset } = query.value;
    const result = await deps.getReportQueue.execute({
      ...(status === undefined ? {} : { statuses: status }),
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    });
    return sendResult(
      c,
      result.map((page): ReportQueueResponse => ({
        total: page.total,
        items: page.items.map((r) => ({
          reportId: r.reportId,
          reporterId: r.reporterId,
          reportedUserId: r.reportedUserId,
          matchId: r.matchId,
          category: r.category,
          severity: r.severity,
          status: r.status,
          urgent: r.urgent,
          dueAt: r.dueAt?.toISOString() ?? null,
          overdue: r.overdue,
          handledBy: r.handledBy,
          createdAt: r.createdAt.toISOString(),
        })),
      })),
    );
  });

  routes.get('/admin/reports/:id', admin, async (c) => {
    const result = await deps.getReportDetail.execute({ reportId: c.req.param('id'), actor: actorOf(c) });
    return sendResult(
      c,
      result.map((r): ReportDetailResponse => ({
        reportId: r.id,
        reporterId: r.reporterId,
        reportedUserId: r.reportedUserId,
        matchId: r.matchId,
        category: r.category,
        severity: r.severity,
        status: r.status,
        urgent: r.urgent,
        dueAt: r.dueAt?.toISOString() ?? null,
        overdue: r.overdue,
        handledBy: r.handledBy,
        createdAt: r.createdAt.toISOString(),
        description: r.description,
        evidence: r.evidence.map((e) => ({ key: e.key, url: e.url, expiresAt: e.expiresAt.toISOString() })),
        conclusion: r.conclusion,
        closedAt: r.closedAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
        version: r.version,
      })),
    );
  });

  routes.post('/admin/reports/:id/start-review', admin, async (c) => {
    const result = await deps.startReportReview.execute({ reportId: c.req.param('id'), actor: actorOf(c) });
    return sendResult(c, result.map(toActionResponse));
  });

  routes.post('/admin/reports/:id/resolve', admin, async (c) => {
    const body = await parseBody(c, resolveReportBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.resolveReport.execute({
      reportId: c.req.param('id'),
      outcome: body.value.outcome,
      conclusion: body.value.conclusion,
      actor: actorOf(c),
    });
    return sendResult(c, result.map(toActionResponse));
  });

  routes.get('/admin/flagged-messages', admin, async (c) => {
    const query = parseQuery(c, flaggedMessageQueueQuerySchema);
    if (query.isErr()) return query.error;
    const { cursor: rawCursor, limit } = query.value;
    const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
    if (rawCursor !== undefined && cursor === null) {
      return problemResponse(c, domainError('VALIDATION_FAILED'), {
        errors: [{ path: 'cursor', message: 'cursor không hợp lệ' }],
      });
    }
    const result = await deps.listFlaggedMessages.execute({
      cursor,
      ...(limit === undefined ? {} : { limit }),
    });
    return sendResult(
      c,
      result.map((page): FlaggedMessageQueueResponse => ({
        items: page.items.map(toFlaggedSummary),
        nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      })),
    );
  });

  routes.get('/admin/flagged-messages/:id', admin, async (c) => {
    const result = await deps.getFlaggedMessage.execute({ messageId: c.req.param('id'), actor: actorOf(c) });
    return sendResult(
      c,
      result.map((m): FlaggedMessageDetailResponse => ({
        ...toFlaggedSummary(m),
        body: m.body,
        maskedBody: m.maskedBody,
      })),
    );
  });

  routes.post('/admin/users/:id/ban', admin, async (c) => {
    const body = await parseBody(c, banUserBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.banUser.execute({
      userId: c.req.param('id'),
      reason: body.value.reason,
      reportId: body.value.reportId ?? null,
      actor: actorOf(c),
    });
    return sendResult(
      c,
      result.map((b): BanUserResponse => ({
        banId: b.banId,
        userId: b.userId,
        reportId: b.reportId,
        bannedBy: b.bannedBy,
        bannedAt: b.bannedAt.toISOString(),
      })),
      201,
    );
  });

  return routes;
}
