import { createLogger } from '@tamgiao/config';
import {
  adminPartnerListResponseSchema,
  adminPartnerSchema,
  adminPartnerStaffListResponseSchema,
  adminPartnerStaffSchema,
  partnerListResponseSchema,
  partnerMeResponseSchema,
  partnerSessionResponseSchema,
  problemSchema,
} from '@tamgiao/contracts';
import { createDatabase, DrizzleUnitOfWork, type Database } from '@tamgiao/db';
import { createRequireAdmin, handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { addDuration, FakeClock, fail, newId, ok } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PARTNER_MAX_FAILED_LOGINS, PARTNER_STAFF_TOKEN_TTL_HOURS } from '../domain/partner-staff.js';
import { createBillingModule, FakePaymentGateway } from '../index.js';
import { RecordingPartnerAuditLogger } from './partner-fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const PIN = '246810';
const DEVICE = 'device-aaaa-0001';

let database: Database;
let app: Hono<AppEnv>;
const clock = new FakeClock(T0);
const audit = new RecordingPartnerAuditLogger();
const logLines: string[] = [];

/** Token admin giả: `manager.<id>` có `partner:manage`; `reviewer.<id>` chỉ có `kyc:review`. */
const MANAGER = newId<'Admin'>();
const managerToken = `manager.${MANAGER}`;
const reviewerToken = `reviewer.${newId<'Admin'>()}`;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  const uow = new DrizzleUnitOfWork(database.pool);
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const requireAdmin = createRequireAdmin(async (token) => {
    const [role, adminId] = token.split('.');
    if (adminId === undefined) return fail('UNAUTHENTICATED');
    const permissions = role === 'manager' ? ['partner:manage'] : ['kyc:review'];
    return ok({ adminId, sessionId: newId(), role: role ?? '', permissions });
  });
  const module = createBillingModule({
    uow,
    clock,
    secret: Buffer.alloc(32, 5),
    requireUser,
    requireAdmin,
    auditLogger: audit,
    paymentGateway: new FakePaymentGateway({ secret: 'partner-test-webhook-secret', clock }),
    paymentGatewayName: 'fake',
    paymentReturnUrl: 'tamgiao://payments/return',
  });
  const logger = createLogger({
    service: 'api',
    level: 'debug',
    destination: { write: (line: string) => void logLines.push(line) },
  });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(logger));
  app.route('/', module.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);
});
beforeEach(async () => {
  await resetDatabase(database.pool);
  clock.set(T0);
  audit.entries = [];
  logLines.length = 0;
});
afterAll(() => database.close());

const json = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const asAdmin = (token = managerToken) => ({ authorization: `Bearer ${token}` });
const asUser = () => ({ 'x-test-user': newId<'User'>() });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const code = async (res: Response) => problemSchema.parse(await res.json()).code;

async function createPartner(name: string, tags: string[] = []) {
  const res = await json('POST', '/admin/partners', asAdmin(), {
    name,
    address: '115 Hồ Tùng Mậu, Quận 1',
    photoUrl: 'https://cdn.example.com/p.jpg',
    tags,
  });
  expect(res.status).toBe(201);
  return adminPartnerSchema.parse(await res.json());
}

async function createStaff(partnerId: string, body: Record<string, unknown> = {}) {
  const res = await json('POST', `/admin/partners/${partnerId}/staff`, asAdmin(), {
    name: 'Lan',
    pin: PIN,
    deviceId: DEVICE,
    ...body,
  });
  expect(res.status).toBe(201);
  return adminPartnerStaffSchema.parse(await res.json());
}

const login = (staffId: string, pin = PIN, deviceId = DEVICE) =>
  json('POST', '/partner/auth/login', {}, { staffId, pin, deviceId });

async function loginToken(staffId: string) {
  const res = await login(staffId);
  expect(res.status).toBe(200);
  return partnerSessionResponseSchema.parse(await res.json());
}

const deactivate = (partnerId: string) =>
  json('PATCH', `/admin/partners/${partnerId}`, asAdmin(), { active: false });

describe('quyền admin partner:manage', () => {
  it.each([
    ['GET', '/admin/partners', undefined],
    ['POST', '/admin/partners', { name: 'A', address: 'B' }],
    ['GET', `/admin/partners/${newId()}`, undefined],
    ['PATCH', `/admin/partners/${newId()}`, { active: false }],
    ['GET', `/admin/partners/${newId()}/staff`, undefined],
    ['POST', `/admin/partners/${newId()}/staff`, { name: 'Lan', pin: PIN }],
    ['PATCH', `/admin/partners/${newId()}/staff/${newId()}`, { active: false }],
  ])('%s %s: chưa đăng nhập → 401, thiếu quyền → 403', async (method, path, body) => {
    const anon = await json(method, path, {}, body);
    expect(anon.status).toBe(401);
    expect(await code(anon)).toBe('UNAUTHENTICATED');
    const reviewer = await json(method, path, asAdmin(reviewerToken), body);
    expect(reviewer.status).toBe(403);
    expect(await code(reviewer)).toBe('FORBIDDEN');
  });

  it('người dùng app không gọi được route admin', async () => {
    const res = await json('GET', '/admin/partners', asUser());
    expect(res.status).toBe(401);
  });
});

describe('CRUD quán (admin)', () => {
  it('tạo / xem / sửa / tắt quán, lọc theo active; ghi audit cùng thao tác', async () => {
    const bean = await createPartner('The Running Bean', ['yên tĩnh', 'Yên tĩnh']);
    expect(bean).toMatchObject({
      active: true,
      tags: ['yên tĩnh'],
      photoUrl: 'https://cdn.example.com/p.jpg',
    });
    const runam = await createPartner('RuNam Bistro');

    const got = await json('GET', `/admin/partners/${bean.id}`, asAdmin());
    expect(adminPartnerSchema.parse(await got.json()).name).toBe('The Running Bean');

    const patched = await json('PATCH', `/admin/partners/${bean.id}`, asAdmin(), {
      address: 'Địa chỉ mới',
      photoUrl: null,
    });
    expect(patched.status).toBe(200);
    expect(adminPartnerSchema.parse(await patched.json())).toMatchObject({
      address: 'Địa chỉ mới',
      photoUrl: null,
    });

    expect((await deactivate(runam.id)).status).toBe(200);
    const all = adminPartnerListResponseSchema.parse(
      await (await json('GET', '/admin/partners', asAdmin())).json(),
    );
    expect(all.items.map((p) => p.name)).toEqual(['RuNam Bistro', 'The Running Bean']);
    const inactive = adminPartnerListResponseSchema.parse(
      await (await json('GET', '/admin/partners?active=false', asAdmin())).json(),
    );
    expect(inactive.items.map((p) => p.id)).toEqual([runam.id]);

    expect(audit.entries.map((e) => e.action)).toEqual([
      'partner.create',
      'partner.create',
      'partner.update',
      'partner.update',
    ]);
    expect(audit.entries[3]).toMatchObject({
      actor: { type: 'admin', id: MANAGER },
      targetType: 'partner',
      targetId: runam.id,
      meta: { fields: ['active'], active: false },
    });
  });

  it('dữ liệu sai → 422; quán không tồn tại / id rác → 404', async () => {
    const bad = await json('POST', '/admin/partners', asAdmin(), {
      name: '',
      address: 'x',
      photoUrl: 'http://a.b',
    });
    expect(bad.status).toBe(422);
    const emptyPatch = await json('PATCH', `/admin/partners/${newId()}`, asAdmin(), {});
    expect(emptyPatch.status).toBe(422);
    for (const id of [newId(), 'not-a-uuid']) {
      const res = await json('GET', `/admin/partners/${id}`, asAdmin());
      expect(res.status).toBe(404);
      expect(await code(res)).toBe('PARTNER_NOT_FOUND');
    }
  });
});

describe('GET /partners (người dùng app)', () => {
  it('cần đăng nhập; chỉ trả quán active, không lộ trường quản trị', async () => {
    expect((await json('GET', '/partners', {})).status).toBe(401);
    const bean = await createPartner('The Running Bean');
    const runam = await createPartner('RuNam Bistro');
    await deactivate(runam.id);

    const res = await json('GET', '/partners', asUser());
    expect(res.status).toBe(200);
    const raw: unknown = await res.json();
    const body = partnerListResponseSchema.parse(raw);
    expect(body.items).toEqual([
      { id: bean.id, name: bean.name, address: bean.address, photoUrl: bean.photoUrl, tags: [] },
    ]);
    expect(JSON.stringify(raw)).not.toContain('active');
  });
});

describe('nhân viên quán', () => {
  it('tạo nhân viên: chỉ lưu hash PIN, không trả/log PIN; PIN sai định dạng → 422', async () => {
    const p = await createPartner('The Running Bean');
    const staff = await createStaff(p.id);
    expect(staff).toMatchObject({ partnerId: p.id, deviceId: DEVICE, active: true, lockedUntil: null });

    const { rows } = await database.pool.query<{ pin_hash: string }>(
      'select pin_hash from billing.partner_staff where id = $1',
      [staff.id],
    );
    expect(rows[0]?.pin_hash.startsWith('scrypt$')).toBe(true);
    expect(rows[0]?.pin_hash).not.toContain(PIN);

    const list = adminPartnerStaffListResponseSchema.parse(
      await (await json('GET', `/admin/partners/${p.id}/staff`, asAdmin())).json(),
    );
    expect(list.items.map((s) => s.id)).toEqual([staff.id]);
    expect(JSON.stringify(list)).not.toContain('pin');

    const bad = await json('POST', `/admin/partners/${p.id}/staff`, asAdmin(), { name: 'Lan', pin: '12ab' });
    expect(bad.status).toBe(422);
    await login(staff.id, '000000');
    expect(logLines.join('\n')).not.toContain(PIN);
    expect(logLines.join('\n')).not.toContain('000000');
  });

  it('đăng nhập PIN + thiết bị → token partner, dùng được cho /partner/auth/me', async () => {
    const p = await createPartner('The Running Bean');
    const staff = await createStaff(p.id);
    const session = await loginToken(staff.id);
    expect(session.expiresAt).toBe(addDuration(T0, { hours: PARTNER_STAFF_TOKEN_TTL_HOURS }).toISOString());
    expect(session.partner).toEqual({ id: p.id, name: p.name });

    const me = await json('GET', '/partner/auth/me', bearer(session.token));
    expect(me.status).toBe(200);
    expect(partnerMeResponseSchema.parse(await me.json()).staff).toEqual({ id: staff.id, name: 'Lan' });

    // Không có token / token người dùng app / token hết hạn → 401.
    expect(await code(await json('GET', '/partner/auth/me', {}))).toBe('PARTNER_TOKEN_INVALID');
    expect(await code(await json('GET', '/partner/auth/me', bearer('a.b.c')))).toBe('PARTNER_TOKEN_INVALID');
    clock.set(addDuration(T0, { hours: PARTNER_STAFF_TOKEN_TTL_HOURS }));
    const expired = await json('GET', '/partner/auth/me', bearer(session.token));
    expect(expired.status).toBe(401);
  });

  it('sai PIN / sai thiết bị → 401; đủ số lần sai → 429 khoá, admin đặt lại PIN thì mở khoá', async () => {
    const p = await createPartner('The Running Bean');
    const staff = await createStaff(p.id);
    expect(await code(await login(staff.id, PIN, 'device-bbbb-0002'))).toBe('PARTNER_LOGIN_FAILED');
    for (let i = 2; i < PARTNER_MAX_FAILED_LOGINS; i++) {
      const res = await login(staff.id, '000000');
      expect(res.status).toBe(401);
    }
    const locked = await login(staff.id, '000000');
    expect(locked.status).toBe(429);
    expect(problemSchema.parse(await locked.json()).meta).toEqual({ retryAfterSeconds: 15 * 60 });
    expect((await login(staff.id)).status).toBe(429);

    const reset = await json('PATCH', `/admin/partners/${p.id}/staff/${staff.id}`, asAdmin(), {
      pin: '135790',
    });
    expect(reset.status).toBe(200);
    expect((await login(staff.id, '135790')).status).toBe(200);
  });

  it('đặt lại PIN thu hồi token đã cấp', async () => {
    const p = await createPartner('The Running Bean');
    const staff = await createStaff(p.id);
    const { token } = await loginToken(staff.id);
    await json('PATCH', `/admin/partners/${p.id}/staff/${staff.id}`, asAdmin(), { pin: '135790' });
    const me = await json('GET', '/partner/auth/me', bearer(token));
    expect(me.status).toBe(401);
    expect(await code(me)).toBe('PARTNER_TOKEN_INVALID');
  });

  it('nhân viên không tồn tại → 401 PARTNER_LOGIN_FAILED', async () => {
    const res = await login(newId());
    expect(res.status).toBe(401);
    expect(await code(res)).toBe('PARTNER_LOGIN_FAILED');
  });
});

describe('AC1: quán bị tắt active', () => {
  it('không đăng nhập được, token cũ bị từ chối, không xuất hiện trong danh sách; bật lại thì hoạt động lại', async () => {
    const p = await createPartner('The Running Bean');
    const staff = await createStaff(p.id);
    const { token } = await loginToken(staff.id);
    expect((await json('GET', '/partner/auth/me', bearer(token))).status).toBe(200);

    expect((await deactivate(p.id)).status).toBe(200);

    const relogin = await login(staff.id);
    expect(relogin.status).toBe(403);
    expect(await code(relogin)).toBe('PARTNER_INACTIVE');
    const me = await json('GET', '/partner/auth/me', bearer(token));
    expect(me.status).toBe(403);
    expect(await code(me)).toBe('PARTNER_INACTIVE');
    const list = partnerListResponseSchema.parse(await (await json('GET', '/partners', asUser())).json());
    expect(list.items).toEqual([]);

    await json('PATCH', `/admin/partners/${p.id}`, asAdmin(), { active: true });
    expect((await login(staff.id)).status).toBe(200);
    expect(
      partnerListResponseSchema.parse(await (await json('GET', '/partners', asUser())).json()).items,
    ).toHaveLength(1);
  });

  it('nhân viên bị vô hiệu hoá → không đăng nhập được, token cũ bị từ chối', async () => {
    const p = await createPartner('The Running Bean');
    const staff = await createStaff(p.id);
    const { token } = await loginToken(staff.id);
    await json('PATCH', `/admin/partners/${p.id}/staff/${staff.id}`, asAdmin(), { active: false });
    expect(await code(await login(staff.id))).toBe('PARTNER_INACTIVE');
    expect((await json('GET', '/partner/auth/me', bearer(token))).status).toBe(401);
  });
});
