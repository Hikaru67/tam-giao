import {
  adminPartnersQuerySchema,
  createPartnerBodySchema,
  createPartnerStaffBodySchema,
  updatePartnerBodySchema,
  updatePartnerStaffBodySchema,
  type AdminPartner,
  type AdminPartnerListResponse,
  type AdminPartnerStaff,
  type AdminPartnerStaffListResponse,
} from '@tamgiao/contracts';
import { parseBody, parseQuery, sendResult, type AppEnv, type RequireAdmin } from '@tamgiao/http';
import { ok } from '@tamgiao/kernel';
import { Hono, type Context } from 'hono';
import type {
  CreatePartnerStaff,
  ListPartnerStaff,
  UpdatePartnerStaff,
} from '../application/partner/manage-partner-staff.js';
import type {
  CreatePartner,
  GetPartner,
  ListPartners,
  UpdatePartner,
} from '../application/partner/manage-partners.js';
import type {
  PartnerAdminActor,
  PartnerStaffView,
  PartnerView,
} from '../application/partner/partner-views.js';

export interface PartnerAdminRoutesDeps {
  readonly createPartner: CreatePartner;
  readonly updatePartner: UpdatePartner;
  readonly getPartner: GetPartner;
  readonly listPartners: ListPartners;
  readonly createStaff: CreatePartnerStaff;
  readonly updateStaff: UpdatePartnerStaff;
  readonly listStaff: ListPartnerStaff;
  readonly requireAdmin: RequireAdmin;
}

const PARTNER_PERMISSION = 'partner:manage';

const toAdminPartner = (p: PartnerView): AdminPartner => ({
  id: p.id,
  name: p.name,
  address: p.address,
  photoUrl: p.photoUrl,
  tags: [...p.tags],
  active: p.active,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

const toAdminStaff = (s: PartnerStaffView): AdminPartnerStaff => ({
  id: s.id,
  partnerId: s.partnerId,
  name: s.name,
  deviceId: s.deviceId,
  active: s.active,
  lockedUntil: s.lockedUntil?.toISOString() ?? null,
  lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

const actorOf = (c: Context<AppEnv>): PartnerAdminActor => {
  const ip = c.get('clientIp');
  return { adminId: c.get('admin').adminId, ip: ip === 'unknown' ? null : ip };
};

/** Quản lý quán đối tác + tài khoản nhân viên quán (BE-S4-06), permission `partner:manage`. */
export function createPartnerAdminRoutes(deps: PartnerAdminRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const admin = deps.requireAdmin(PARTNER_PERMISSION);

  routes.get('/admin/partners', admin, async (c) => {
    const query = parseQuery(c, adminPartnersQuerySchema);
    if (query.isErr()) return query.error;
    const items = await deps.listPartners.execute(query.value);
    const body: AdminPartnerListResponse = { items: items.map(toAdminPartner) };
    return sendResult(c, ok(body));
  });

  routes.post('/admin/partners', admin, async (c) => {
    const body = await parseBody(c, createPartnerBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.createPartner.execute({ actor: actorOf(c), ...body.value });
    return sendResult(c, result.map(toAdminPartner), 201);
  });

  routes.get('/admin/partners/:id', admin, async (c) => {
    const result = await deps.getPartner.execute(c.req.param('id'));
    return sendResult(c, result.map(toAdminPartner));
  });

  routes.patch('/admin/partners/:id', admin, async (c) => {
    const body = await parseBody(c, updatePartnerBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.updatePartner.execute({
      actor: actorOf(c),
      partnerId: c.req.param('id'),
      patch: body.value,
    });
    return sendResult(c, result.map(toAdminPartner));
  });

  routes.get('/admin/partners/:id/staff', admin, async (c) => {
    const result = await deps.listStaff.execute(c.req.param('id'));
    return sendResult(
      c,
      result.map((items): AdminPartnerStaffListResponse => ({ items: items.map(toAdminStaff) })),
    );
  });

  routes.post('/admin/partners/:id/staff', admin, async (c) => {
    const body = await parseBody(c, createPartnerStaffBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.createStaff.execute({
      actor: actorOf(c),
      partnerId: c.req.param('id'),
      ...body.value,
    });
    return sendResult(c, result.map(toAdminStaff), 201);
  });

  routes.patch('/admin/partners/:id/staff/:staffId', admin, async (c) => {
    const body = await parseBody(c, updatePartnerStaffBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.updateStaff.execute({
      actor: actorOf(c),
      partnerId: c.req.param('id'),
      staffId: c.req.param('staffId'),
      ...body.value,
    });
    return sendResult(c, result.map(toAdminStaff));
  });

  return routes;
}
