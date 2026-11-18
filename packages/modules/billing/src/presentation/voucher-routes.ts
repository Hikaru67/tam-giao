import {
  redeemVoucherBodySchema,
  type MyVouchersResponse,
  type RedeemVoucherResponse,
  type VoucherQrResponse,
} from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { ok, type Money } from '@tamgiao/kernel';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { RedeemVoucher } from '../application/voucher/redeem-voucher.js';
import type { GetVoucherQr, ListMyVouchers } from '../application/voucher/voucher-queries.js';
import type { PartnerEnv, RequirePartnerStaff } from './partner-auth-middleware.js';

export interface VoucherRoutesDeps {
  readonly listMyVouchers: ListMyVouchers;
  readonly getVoucherQr: GetVoucherQr;
  readonly redeemVoucher: RedeemVoucher;
  readonly requireUser: MiddlewareHandler<AppEnv>;
  readonly requirePartnerStaff: RequirePartnerStaff;
}

const toVnd = (money: Money): number => Number(money.amount);
const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

/**
 * Route voucher (BE-S4-05): `GET /me/vouchers`, `GET /me/vouchers/:id/qr` (người dùng app) và
 * `POST /partner/vouchers/redeem` (nhân viên quán, guard `requirePartnerStaff`). Token QR không được log.
 */
export function createVoucherRoutes(deps: VoucherRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/me/vouchers', deps.requireUser, async (c) => {
    const items = await deps.listMyVouchers.execute(c.get('auth').userId);
    const body: MyVouchersResponse = {
      items: items.map((v) => ({
        id: v.id,
        status: v.status,
        valueVnd: toVnd(v.value),
        expiresAt: iso(v.expiresAt),
        partnerId: v.partnerId,
        issuedAt: v.issuedAt.toISOString(),
        activatedAt: iso(v.activatedAt),
        redeemedAt: iso(v.redeemedAt),
      })),
    };
    return sendResult(c, ok(body));
  });

  routes.get('/me/vouchers/:id/qr', deps.requireUser, async (c) => {
    const result = await deps.getVoucherQr.execute({
      userId: c.get('auth').userId,
      voucherId: c.req.param('id'),
    });
    return sendResult(
      c,
      result.map((t): VoucherQrResponse => ({ token: t.token, expiresAt: t.expiresAt.toISOString() })),
    );
  });

  const partnerRoutes = new Hono<PartnerEnv>();
  partnerRoutes.post('/partner/vouchers/redeem', deps.requirePartnerStaff, async (c) => {
    // `PartnerEnv` chỉ thêm biến vào `AppEnv` → dùng được helper viết cho `Context<AppEnv>`.
    const base = c as unknown as Context<AppEnv>;
    const body = await parseBody(base, redeemVoucherBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.redeemVoucher.execute({
      token: body.value.token,
      partnerId: c.get('partnerStaff').partnerId,
    });
    return sendResult(
      base,
      result.map((r): RedeemVoucherResponse => ({
        voucherId: r.voucherId,
        status: 'REDEEMED',
        valueVnd: toVnd(r.value),
        redeemedAt: r.redeemedAt.toISOString(),
      })),
    );
  });
  routes.route('/', partnerRoutes);

  return routes;
}
