import { createLogger } from '@tamgiao/config';
import {
  adminPartnerSchema,
  adminPartnerStaffSchema,
  myVouchersResponseSchema,
  partnerSessionResponseSchema,
  problemSchema,
  redeemVoucherResponseSchema,
  verificationCheckoutResponseSchema,
  voucherQrResponseSchema,
} from '@tamgiao/contracts';
import { VOUCHER_TTL_DAYS, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { createDatabase, DrizzleUnitOfWork, OutboxWriter, type Database } from '@tamgiao/db';
import { createRequireAdmin, handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { addDuration, FakeClock, fail, newId, ok } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivateVoucher } from '../application/voucher/activate-voucher.js';
import type { VoucherId } from '../domain/voucher.js';
import { VOUCHER_QR_TOKEN_TTL_SECONDS } from '../domain/voucher-qr.js';
import { createBillingModule, createVoucherExpiryJob, FakePaymentGateway } from '../index.js';
import { DrizzleVoucherLifecycleRepository } from '../infrastructure/drizzle-voucher-repository.js';
import { RecordingPartnerAuditLogger } from './partner-fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const PIN = '246810';
const DEVICE = 'device-voucher-0001';
const managerToken = `manager.${newId<'Admin'>()}`;

let database: Database;
let uow: DrizzleUnitOfWork;
let app: Hono<AppEnv>;
const clock = new FakeClock(T0);
const gateway = new FakePaymentGateway({ secret: 'voucher-int-webhook-secret', clock });

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const requireAdmin = createRequireAdmin(async (token) => {
    const [role, adminId] = token.split('.');
    if (role !== 'manager' || adminId === undefined) return fail('UNAUTHENTICATED');
    return ok({ adminId, sessionId: newId(), role, permissions: ['partner:manage'] });
  });
  const module = createBillingModule({
    uow,
    clock,
    secret: Buffer.alloc(32, 5),
    requireUser,
    requireAdmin,
    auditLogger: new RecordingPartnerAuditLogger(),
    paymentGateway: gateway,
    paymentGatewayName: 'fake',
    paymentReturnUrl: 'tamgiao://payments/return',
    devPaymentSimulator: gateway,
  });
  const logger = createLogger({ service: 'api', level: 'silent', destination: { write: () => undefined } });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(logger));
  app.route('/', module.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);
});
beforeEach(async () => {
  await resetDatabase(database.pool);
  clock.set(T0);
});
afterAll(() => database.close());

const json = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const code = async (res: Response) => problemSchema.parse(await res.json()).code;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const asUser = (userId: string) => ({ 'x-test-user': userId });

/** Tạo quán + nhân viên rồi đăng nhập → token partner. */
async function partnerSession(name = 'The Running Bean') {
  const p = await json('POST', '/admin/partners', bearer(managerToken), { name, address: '115 Hồ Tùng Mậu' });
  expect(p.status).toBe(201);
  const partner = adminPartnerSchema.parse(await p.json());
  const s = await json('POST', `/admin/partners/${partner.id}/staff`, bearer(managerToken), {
    name: 'Lan',
    pin: PIN,
    deviceId: DEVICE,
  });
  expect(s.status).toBe(201);
  const staff = adminPartnerStaffSchema.parse(await s.json());
  const login = await json(
    'POST',
    '/partner/auth/login',
    {},
    { staffId: staff.id, pin: PIN, deviceId: DEVICE },
  );
  expect(login.status).toBe(200);
  return { partnerId: partner.id, token: partnerSessionResponseSchema.parse(await login.json()).token };
}

/**
 * Voucher `ACTIVE` qua luồng thật: checkout + webhook giả lập (voucher `RESERVED`) → đặt hạn như khi hồ sơ được duyệt
 * (BE-S4-04 sở hữu bước này) → `ActivateVoucher` với repository Drizzle.
 */
async function activeVoucher(userId: string, approvedAt = T0): Promise<VoucherId> {
  const c = await app.request('/me/payments/verification', {
    method: 'POST',
    headers: { 'x-test-user': userId, 'idempotency-key': `key-${newId()}` },
  });
  const { orderId } = verificationCheckoutResponseSchema.parse(await c.json());
  const sim = await json('POST', `/dev/payments/fake/${orderId}`, {}, { outcome: 'SUCCEEDED' });
  expect(sim.status).toBe(200);
  const { rows } = await database.pool.query<{ id: VoucherId }>(
    `update billing.vouchers set expires_at = $2 where user_id = $1 returning id`,
    [userId, addDuration(approvedAt, { days: VOUCHER_TTL_DAYS })],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('voucher not issued');
  const activate = new ActivateVoucher({
    uow,
    clock,
    vouchers: new DrizzleVoucherLifecycleRepository(new OutboxWriter()),
  });
  const activated = await activate.execute({ voucherId: id });
  expect(activated.isOk()).toBe(true);
  return id;
}

async function qrToken(userId: string, voucherId: string): Promise<string> {
  const res = await app.request(`/me/vouchers/${voucherId}/qr`, { headers: asUser(userId) });
  expect(res.status).toBe(200);
  return voucherQrResponseSchema.parse(await res.json()).token;
}

const redeem = (partnerToken: string, token: string) =>
  json('POST', '/partner/vouchers/redeem', bearer(partnerToken), { token });

async function counts(voucherId: string) {
  const { rows } = await database.pool.query<{ redeemLedger: number; redeemed: number; expired: number }>(
    `select (select count(*)::int from billing.ledger_entries where voucher_id = $1 and type = 'VOUCHER_REDEEM')
              as "redeemLedger",
            (select count(*)::int from platform.outbox where event_type = 'VoucherRedeemed' and aggregate_id = $1::text)
              as redeemed,
            (select count(*)::int from platform.outbox where event_type = 'VoucherExpired' and aggregate_id = $1::text)
              as expired`,
    [voucherId],
  );
  return rows[0];
}

async function voucherRow(id: string) {
  const { rows } = await database.pool.query<{ status: string; redeemed_by_partner_id: string | null }>(
    `select status, redeemed_by_partner_id from billing.vouchers where id = $1`,
    [id],
  );
  return rows[0];
}

describe('ActivateVoucher (Postgres)', () => {
  it('RESERVED → ACTIVE + VoucherActivated trong outbox', async () => {
    const id = await activeVoucher(newId<'User'>());
    expect((await voucherRow(id))?.status).toBe('ACTIVE');
    const { rows } = await database.pool.query(
      `select 1 from platform.outbox where event_type = 'VoucherActivated' and aggregate_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('GET /me/vouchers, GET /me/vouchers/:id/qr', () => {
  it('liệt kê voucher của chính người dùng', async () => {
    const user = newId<'User'>();
    const id = await activeVoucher(user);
    await activeVoucher(newId<'User'>());
    const res = await app.request('/me/vouchers', { headers: asUser(user) });
    expect(res.status).toBe(200);
    const body = myVouchersResponseSchema.parse(await res.json());
    expect(body.items).toEqual([
      expect.objectContaining({
        id,
        status: 'ACTIVE',
        valueVnd: VOUCHER_VND,
        partnerId: null,
        expiresAt: addDuration(T0, { days: VOUCHER_TTL_DAYS }).toISOString(),
      }),
    ]);
  });

  it('QR: chủ voucher → token + expiresAt; người khác / id rác → 404; chưa đăng nhập → 401', async () => {
    const user = newId<'User'>();
    const id = await activeVoucher(user);
    const res = await app.request(`/me/vouchers/${id}/qr`, { headers: asUser(user) });
    expect(res.status).toBe(200);
    const qr = voucherQrResponseSchema.parse(await res.json());
    expect(qr.expiresAt).toBe(new Date(T0.getTime() + VOUCHER_QR_TOKEN_TTL_SECONDS * 1_000).toISOString());

    const other = await app.request(`/me/vouchers/${id}/qr`, { headers: asUser(newId<'User'>()) });
    expect(other.status).toBe(404);
    expect(await code(other)).toBe('VOUCHER_NOT_FOUND');
    const junk = await app.request('/me/vouchers/not-an-id/qr', { headers: asUser(user) });
    expect(junk.status).toBe(404);
    expect((await app.request(`/me/vouchers/${id}/qr`)).status).toBe(401);
  });
});

describe('POST /partner/vouchers/redeem', () => {
  it('đổi thành công → REDEEMED, 1 ledger VOUCHER_REDEEM, 1 VoucherRedeemed; quét lại → 409 (AC1)', async () => {
    const user = newId<'User'>();
    const id = await activeVoucher(user);
    const partner = await partnerSession();
    const token = await qrToken(user, id);

    const first = await redeem(partner.token, token);
    expect(first.status).toBe(200);
    expect(redeemVoucherResponseSchema.parse(await first.json())).toEqual({
      voucherId: id,
      status: 'REDEEMED',
      valueVnd: VOUCHER_VND,
      redeemedAt: T0.toISOString(),
    });
    expect(await voucherRow(id)).toEqual({ status: 'REDEEMED', redeemed_by_partner_id: partner.partnerId });

    const second = await redeem(partner.token, token);
    expect(second.status).toBe(409);
    expect(await code(second)).toBe('VOUCHER_ALREADY_REDEEMED');
    expect(await counts(id)).toEqual({ redeemLedger: 1, redeemed: 1, expired: 0 });
  });

  it('quét cùng QR đồng thời 5 lần → đúng 1 thành công, còn lại VOUCHER_ALREADY_REDEEMED (AC1, A10)', async () => {
    const user = newId<'User'>();
    const id = await activeVoucher(user);
    const partner = await partnerSession();
    const token = await qrToken(user, id);

    const results = await runConcurrently(5, async () => {
      const res = await redeem(partner.token, token);
      return { status: res.status, code: res.status === 200 ? 'OK' : await code(res) };
    });
    const settled = results.map((r) => (r.status === 'fulfilled' ? r.value : { status: 0, code: 'THREW' }));
    expect(settled.filter((r) => r.status === 200)).toHaveLength(1);
    expect(settled.filter((r) => r.code === 'VOUCHER_ALREADY_REDEEMED')).toHaveLength(4);
    expect(await counts(id)).toEqual({ redeemLedger: 1, redeemed: 1, expired: 0 });
  });

  it('thiếu / sai token partner → 401 PARTNER_TOKEN_INVALID, voucher không đổi', async () => {
    const user = newId<'User'>();
    const id = await activeVoucher(user);
    const token = await qrToken(user, id);
    const missing = await json('POST', '/partner/vouchers/redeem', {}, { token });
    expect(missing.status).toBe(401);
    expect(await code(missing)).toBe('PARTNER_TOKEN_INVALID');
    const wrong = await redeem('pt1.bogus.token', token);
    expect(wrong.status).toBe(401);
    expect(await code(wrong)).toBe('PARTNER_TOKEN_INVALID');
    // Token QR của người dùng không dùng làm token partner được.
    expect((await redeem(token, token)).status).toBe(401);
    expect((await voucherRow(id))?.status).toBe('ACTIVE');
  });

  it('token QR bị sửa / hết hạn → 422 VOUCHER_TOKEN_INVALID; body sai → 422 VALIDATION_FAILED (AC2)', async () => {
    const user = newId<'User'>();
    const id = await activeVoucher(user);
    const partner = await partnerSession();
    const token = await qrToken(user, id);

    const tampered = await redeem(partner.token, `${token.slice(0, -2)}xx`);
    expect(tampered.status).toBe(422);
    expect(await code(tampered)).toBe('VOUCHER_TOKEN_INVALID');

    clock.advance({ seconds: VOUCHER_QR_TOKEN_TTL_SECONDS });
    const expired = await redeem(partner.token, token);
    expect(expired.status).toBe(422);
    expect(await code(expired)).toBe('VOUCHER_TOKEN_INVALID');

    const invalidBody = await json('POST', '/partner/vouchers/redeem', bearer(partner.token), {});
    expect(await code(invalidBody)).toBe('VALIDATION_FAILED');
    expect(await counts(id)).toEqual({ redeemLedger: 0, redeemed: 0, expired: 0 });
  });

  it('voucher gắn quán khác → 403 VOUCHER_PARTNER_MISMATCH', async () => {
    const user = newId<'User'>();
    const id = await activeVoucher(user);
    const assigned = await partnerSession('RuNam');
    const other = await partnerSession('Cộng Cà Phê');
    await database.pool.query(`update billing.vouchers set partner_id = $2 where id = $1`, [
      id,
      assigned.partnerId,
    ]);
    const token = await qrToken(user, id);
    const res = await redeem(other.token, token);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('VOUCHER_PARTNER_MISMATCH');
    expect((await redeem(assigned.token, token)).status).toBe(200);
  });
});

describe('job hết hạn voucher (Postgres, AC3)', () => {
  it('voucher quá hạn → EXPIRED + VoucherExpired, không ledger; chạy lại không đổi; redeem → 410 VOUCHER_EXPIRED', async () => {
    const user = newId<'User'>();
    const id = await activeVoucher(user);
    const notDue = await activeVoucher(newId<'User'>(), addDuration(T0, { days: 1 }));
    const expiresAt = addDuration(T0, { days: VOUCHER_TTL_DAYS });
    clock.set(addDuration(expiresAt, { seconds: -30 }));
    const token = await qrToken(user, id);
    const ledgerBefore = await database.pool.query(`select count(*)::int as n from billing.ledger_entries`);

    clock.set(expiresAt);
    const job = createVoucherExpiryJob({ uow, clock });
    expect(await job.execute()).toEqual({ expired: 1, batches: 1 });
    expect((await voucherRow(id))?.status).toBe('EXPIRED');
    expect((await voucherRow(notDue))?.status).toBe('ACTIVE');
    expect(await job.execute()).toEqual({ expired: 0, batches: 1 });
    expect(await counts(id)).toEqual({ redeemLedger: 0, redeemed: 0, expired: 1 });
    const ledgerAfter = await database.pool.query(`select count(*)::int as n from billing.ledger_entries`);
    expect(ledgerAfter.rows).toEqual(ledgerBefore.rows);

    // Đăng nhập sau khi đổi giờ — token partner chỉ sống một ca (8 giờ).
    const partner = await partnerSession();
    const res = await redeem(partner.token, token);
    expect(res.status).toBe(410);
    expect(await code(res)).toBe('VOUCHER_EXPIRED');
  });

  it('dòng đang bị transaction khác khoá → bỏ qua (SKIP LOCKED), lượt sau xử lý', async () => {
    const id = await activeVoucher(newId<'User'>());
    clock.set(addDuration(T0, { days: VOUCHER_TTL_DAYS }));
    const job = createVoucherExpiryJob({ uow, clock });
    const client = await database.pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from billing.vouchers where id = $1 for update', [id]);
      expect(await job.execute()).toEqual({ expired: 0, batches: 1 });
      await client.query('rollback');
    } finally {
      client.release();
    }
    expect((await job.execute()).expired).toBe(1);
    expect((await voucherRow(id))?.status).toBe('EXPIRED');
  });

  it('xử lý theo lô', async () => {
    for (let i = 0; i < 3; i++) await activeVoucher(newId<'User'>());
    clock.set(addDuration(T0, { days: VOUCHER_TTL_DAYS }));
    expect(await createVoucherExpiryJob({ uow, clock }).execute({ batchSize: 2 })).toEqual({
      expired: 3,
      batches: 2,
    });
  });
});
