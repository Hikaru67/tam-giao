import { adminRefundBodySchema, type AdminRefundResponse } from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv, type RequireAdmin } from '@tamgiao/http';
import { Hono } from 'hono';
import type { RequestManualRefund } from '../application/refund/request-manual-refund.js';

export interface RefundAdminRoutesDeps {
  readonly requestManualRefund: RequestManualRefund;
  readonly requireAdmin: RequireAdmin;
}

const REFUND_PERMISSION = 'billing:refund';

/** Admin hoàn tiền thủ công (BE-S4-04), permission `billing:refund`, lý do bắt buộc, ghi audit. */
export function createRefundAdminRoutes(deps: RefundAdminRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const admin = deps.requireAdmin(REFUND_PERMISSION);

  routes.post('/admin/payments/:id/refund', admin, async (c) => {
    const body = await parseBody(c, adminRefundBodySchema);
    if (body.isErr()) return body.error;
    const ip = c.get('clientIp');
    const result = await deps.requestManualRefund.execute({
      actor: { adminId: c.get('admin').adminId, ip: ip === 'unknown' ? null : ip },
      paymentId: c.req.param('id'),
      reason: body.value.reason,
    });
    return sendResult(
      c,
      result.map((v): AdminRefundResponse => ({
        paymentId: v.paymentId,
        status: 'REFUND_PENDING',
        refundRequestedAt: v.refundRequestedAt.toISOString(),
        voucherVoided: v.voucherVoided,
      })),
      202,
    );
  });

  return routes;
}
