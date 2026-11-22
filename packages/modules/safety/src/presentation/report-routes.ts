import { fileReportBodySchema, type FileReportResponse } from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { FileReport, FiledReportView } from '../application/file-report.js';

export interface ReportRoutesDeps {
  readonly fileReport: FileReport;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

const toResponse = (v: FiledReportView): FileReportResponse => ({
  reportId: v.reportId,
  status: v.status,
  category: v.category,
  severity: v.severity,
  urgent: v.urgent,
  dueAt: v.dueAt?.toISOString() ?? null,
  createdAt: v.createdAt.toISOString(),
});

/**
 * Route người dùng app của module safety (BE-S6-05): `POST /me/reports` — màn "Báo cáo Vi phạm & Trung tâm An toàn
 * Khẩn cấp". Mô tả là văn bản tự do (PII) — không log body.
 */
export function createReportRoutes(deps: ReportRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post('/me/reports', deps.requireUser, async (c) => {
    const body = await parseBody(c, fileReportBodySchema);
    if (body.isErr()) return body.error;
    const { reportedUserId, category, description, evidenceKeys, urgentIntervention } = body.value;
    const result = await deps.fileReport.execute({
      reporterId: c.get('auth').userId,
      reportedUserId,
      category,
      description: description ?? null,
      evidenceKeys: evidenceKeys ?? [],
      urgentIntervention: urgentIntervention ?? false,
    });
    return sendResult(c, result.map(toResponse), 201);
  });

  return routes;
}
