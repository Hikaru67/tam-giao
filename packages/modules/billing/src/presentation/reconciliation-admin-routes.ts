import {
  reconciliationReportQuerySchema,
  type ReconciliationReportDto,
  type ReconciliationReportListResponse,
} from '@tamgiao/contracts';
import { parseQuery, problemResponse, sendResult, type AppEnv, type RequireAdmin } from '@tamgiao/http';
import { domainError } from '@tamgiao/kernel';
import { Hono } from 'hono';
import type { ReconciliationReportCursor } from '../application/ports/reconciliation-repository.js';
import type { ListReconciliationReports } from '../application/reconciliation/list-reconciliation-reports.js';
import type { ReconciliationReportView } from '../application/reconciliation/reconciliation-views.js';

export interface ReconciliationAdminRoutesDeps {
  readonly listReports: ListReconciliationReports;
  readonly requireAdmin: RequireAdmin;
}

/**
 * Đọc báo cáo đối soát dùng lại permission `billing:refund`: chính người xử lý hoàn tiền là người điều tra khi sổ
 * lệch; không thêm permission mới chỉ để đọc.
 */
const RECONCILIATION_PERMISSION = 'billing:refund';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cursor mờ cho client: base64url của `<runAt ISO>|<id>`. */
const encodeCursor = (c: ReconciliationReportCursor): string =>
  Buffer.from(`${c.runAt.toISOString()}|${c.id}`, 'utf8').toString('base64url');

function decodeCursor(raw: string): ReconciliationReportCursor | null {
  const [iso, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (iso === undefined || id === undefined || rest.length > 0 || !UUID_PATTERN.test(id)) return null;
  const runAt = new Date(iso);
  return Number.isNaN(runAt.getTime()) ? null : { runAt, id };
}

function toDto(r: ReconciliationReportView): ReconciliationReportDto {
  const t = r.totals;
  return {
    id: r.id,
    reportDate: r.reportDate,
    runAt: r.runAt.toISOString(),
    status: r.status,
    totals: {
      ledgerChargeTotalVnd: t.ledgerChargeTotal.amount.toString(),
      ledgerRefundTotalVnd: t.ledgerRefundTotal.amount.toString(),
      heldPaymentTotalVnd: t.heldPaymentTotal.amount.toString(),
      heldPaymentCount: t.heldPaymentCount,
      voucherIssueEntries: t.voucherIssueEntries,
      voucherRedeemEntries: t.voucherRedeemEntries,
      voucherVoidEntries: t.voucherVoidEntries,
      vouchersByStatus: { ...t.vouchersByStatus },
    },
    mismatches: r.mismatches.map((m) => ({
      check: m.check,
      ledger: m.ledger.toString(),
      state: m.state.toString(),
      difference: m.difference.toString(),
    })),
  };
}

/** `GET /admin/billing/reconciliation-reports` (BE-S4-07): lọc `status`, mới nhất trước, phân trang cursor. */
export function createReconciliationAdminRoutes(deps: ReconciliationAdminRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get(
    '/admin/billing/reconciliation-reports',
    deps.requireAdmin(RECONCILIATION_PERMISSION),
    async (c) => {
      const query = parseQuery(c, reconciliationReportQuerySchema);
      if (query.isErr()) return query.error;
      const { cursor: rawCursor, limit, status } = query.value;

      const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
      if (rawCursor !== undefined && cursor === null) {
        return problemResponse(c, domainError('VALIDATION_FAILED'), {
          errors: [{ path: 'cursor', message: 'cursor không hợp lệ' }],
        });
      }

      const result = await deps.listReports.execute({
        filter: status === undefined ? {} : { status },
        cursor,
        ...(limit === undefined ? {} : { limit }),
      });
      return sendResult(
        c,
        result.map((page): ReconciliationReportListResponse => ({
          items: page.items.map(toDto),
          nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
        })),
      );
    },
  );

  return routes;
}
