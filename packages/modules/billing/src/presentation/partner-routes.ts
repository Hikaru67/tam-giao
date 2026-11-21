import {
  partnerLoginBodySchema,
  type PartnerListResponse,
  type PartnerMeResponse,
  type PartnerSessionResponse,
} from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { ok } from '@tamgiao/kernel';
import { Hono, type MiddlewareHandler } from 'hono';
import type { ListActivePartners } from '../application/partner/manage-partners.js';
import type { PartnerStaffLogin } from '../application/partner/partner-staff-login.js';
import type { PartnerEnv, RequirePartnerStaff } from './partner-auth-middleware.js';

export interface PartnerRoutesDeps {
  readonly listActivePartners: ListActivePartners;
  readonly login: PartnerStaffLogin;
  readonly requireUser: MiddlewareHandler<AppEnv>;
  readonly requirePartnerStaff: RequirePartnerStaff;
}

/**
 * Danh sách quán cho người dùng app (`GET /partners`, chỉ quán `active`) và đăng nhập nhân viên quán
 * (`POST /partner/auth/login`, `GET /partner/auth/me`) — BE-S4-06. PIN không bao giờ được log.
 */
export function createPartnerRoutes(deps: PartnerRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/partners', deps.requireUser, async (c) => {
    const items = await deps.listActivePartners.execute();
    const body: PartnerListResponse = {
      items: items.map((p) => ({
        id: p.id,
        name: p.name,
        address: p.address,
        photoUrl: p.photoUrl,
        tags: [...p.tags],
      })),
    };
    return sendResult(c, ok(body));
  });

  routes.post('/partner/auth/login', async (c) => {
    const body = await parseBody(c, partnerLoginBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.login.execute(body.value);
    return sendResult(
      c,
      result.map((s): PartnerSessionResponse => ({
        token: s.token,
        expiresAt: s.expiresAt.toISOString(),
        staff: s.staff,
        partner: s.partner,
      })),
    );
  });

  const partnerRoutes = new Hono<PartnerEnv>();
  partnerRoutes.get('/partner/auth/me', deps.requirePartnerStaff, (c) => {
    const auth = c.get('partnerStaff');
    const body: PartnerMeResponse = {
      staff: { id: auth.staffId, name: auth.staffName },
      partner: { id: auth.partnerId, name: auth.partnerName },
    };
    return c.json(body);
  });
  routes.route('/', partnerRoutes);

  return routes;
}
