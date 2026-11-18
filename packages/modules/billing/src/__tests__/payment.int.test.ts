import { createLogger } from '@tamgiao/config';
import {
  paymentHistoryResponseSchema,
  problemSchema,
  verificationCheckoutResponseSchema,
  webhookAckResponseSchema,
} from '@tamgiao/contracts';
import { DEPOSIT_VND, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { createDatabase, DrizzleUnitOfWork, type Database } from '@tamgiao/db';
import { createRequireAdmin, handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { FakeClock, fail, newId } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createBillingModule,
  FAKE_SIGNATURE_HEADER,
  FakePaymentGateway,
  type BillingModule,
} from '../index.js';
import { RecordingPartnerAuditLogger } from './partner-fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');

let database: Database;
let app: Hono<AppEnv>;
let appWithoutDev: Hono<AppEnv>;
let billing: BillingModule;
const clock = new FakeClock(T0);
const gateway = new FakePaymentGateway({ secret: 'int-test-webhook-secret', clock });
const logLines: string[] = [];

function buildApp(module: BillingModule): Hono<AppEnv> {
  const logger = createLogger({
    service: 'api',
    level: 'debug',
    destination: { write: (line: string) => void logLines.push(line) },
  });
  const a = new Hono<AppEnv>();
  a.use('*', requestContext(logger));
  a.route('/', module.routes);
  a.notFound(handleNotFound);
  a.onError(handleError);
  return a;
}

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  const uow = new DrizzleUnitOfWork(database.pool);
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const deps = {
    uow,
    clock,
    secret: Buffer.alloc(32, 5),
    requireUser,
    requireAdmin: createRequireAdmin(async () => fail('UNAUTHENTICATED')),
    auditLogger: new RecordingPartnerAuditLogger(),
    paymentGateway: gateway,
    paymentGatewayName: 'fake',
    paymentReturnUrl: 'tamgiao://payments/return',
  };
  billing = createBillingModule({ ...deps, devPaymentSimulator: gateway });
  app = buildApp(billing);
  appWithoutDev = buildApp(createBillingModule(deps));
});
beforeEach(async () => {
  await resetDatabase(database.pool);
  clock.set(T0);
  logLines.length = 0;
});
afterAll(() => database.close());

const code = async (res: Response) => problemSchema.parse(await res.json()).code;

const createCheckout = async (userId: string, key: string): Promise<Response> =>
  app.request('/me/payments/verification', {
    method: 'POST',
    headers: { 'x-test-user': userId, 'idempotency-key': key },
  });

async function checkout(userId: string, key = `key-${newId()}`) {
  const res = await createCheckout(userId, key);
  expect([200, 201]).toContain(res.status);
  return verificationCheckoutResponseSchema.parse(await res.json());
}

const deliver = async (
  hook: { headers: Readonly<Record<string, string>>; rawBody: string },
  target = app,
): Promise<Response> =>
  target.request('/webhooks/payments/fake', { method: 'POST', headers: hook.headers, body: hook.rawBody });

async function counts() {
  const { rows } = await database.pool.query<{
    payments: number;
    succeeded: number;
    ledger: number;
    vouchers: number;
    outbox: number;
  }>(
    `select (select count(*)::int from billing.payments) as payments,
            (select count(*)::int from billing.payments where status = 'SUCCEEDED') as succeeded,
            (select count(*)::int from billing.ledger_entries) as ledger,
            (select count(*)::int from billing.vouchers) as vouchers,
            (select count(*)::int from platform.outbox) as outbox`,
  );
  return rows[0];
}

describe('POST /me/payments/verification', () => {
  it('creates a PENDING payment with checkout (201); same key returns the same checkout (200)', async () => {
    const user = newId<'User'>();
    const res = await createCheckout(user, 'client-key-0001');
    expect(res.status).toBe(201);
    const body = verificationCheckoutResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ status: 'PENDING', amountVnd: DEPOSIT_VND, createdAt: T0.toISOString() });
    expect(body.qrData).toBe(`FAKEPAY|${body.orderId}|${DEPOSIT_VND}`);

    const again = await createCheckout(user, 'client-key-0001');
    expect(again.status).toBe(200);
    expect(verificationCheckoutResponseSchema.parse(await again.json())).toEqual(body);

    const { rows } = await database.pool.query(
      'select status, amount::text as amount, checkout_url, qr_data from billing.payments where user_id = $1',
      [user],
    );
    expect(rows).toEqual([
      {
        status: 'PENDING',
        amount: String(DEPOSIT_VND),
        checkout_url: body.checkoutUrl,
        qr_data: body.qrData,
      },
    ]);
  });

  it('idempotency key in body works; header and body mismatch / missing → 422', async () => {
    const user = newId<'User'>();
    const viaBody = await app.request('/me/payments/verification', {
      method: 'POST',
      headers: { 'x-test-user': user, 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'body-key-0001' }),
    });
    expect(viaBody.status).toBe(201);

    const mismatch = await app.request('/me/payments/verification', {
      method: 'POST',
      headers: {
        'x-test-user': user,
        'content-type': 'application/json',
        'idempotency-key': 'header-key-01',
      },
      body: JSON.stringify({ idempotencyKey: 'body-key-0001' }),
    });
    expect(mismatch.status).toBe(422);
    const missing = await app.request('/me/payments/verification', {
      method: 'POST',
      headers: { 'x-test-user': user },
    });
    expect(missing.status).toBe(422);
    expect(await code(missing)).toBe('VALIDATION_FAILED');
    const unauthenticated = await app.request('/me/payments/verification', { method: 'POST' });
    expect(unauthenticated.status).toBe(401);
  });

  it('2 concurrent requests with different keys → exactly 1 payment, both get it (AC2)', async () => {
    const user = newId<'User'>();
    const results = await runConcurrently(2, (i) => createCheckout(user, `race-key-000${i}`));
    const bodies = await Promise.all(
      results.map(async (r) => {
        if (r.status !== 'fulfilled') throw r.reason;
        expect([200, 201]).toContain(r.value.status);
        return verificationCheckoutResponseSchema.parse(await r.value.json());
      }),
    );
    expect(new Set(bodies.map((b) => b.paymentId)).size).toBe(1);
    expect(await counts()).toMatchObject({ payments: 1 });
  });

  it('5 concurrent requests (same and different keys) → exactly 1 payment with one stored checkout', async () => {
    const user = newId<'User'>();
    const results = await runConcurrently(5, (i) =>
      createCheckout(user, i < 3 ? 'same-key-0001' : `key-000${i}`),
    );
    const bodies = await Promise.all(
      results.map(async (r) => {
        if (r.status !== 'fulfilled') throw r.reason;
        return verificationCheckoutResponseSchema.parse(await r.value.json());
      }),
    );
    expect(new Set(bodies.map((b) => b.paymentId)).size).toBe(1);
    expect(new Set(bodies.map((b) => b.checkoutUrl)).size).toBe(1);
    expect(await counts()).toMatchObject({ payments: 1 });
  });

  it('already paid → 409 PAYMENT_ALREADY_EXISTS', async () => {
    const user = newId<'User'>();
    const first = await checkout(user);
    expect((await deliver(gateway.simulatePayment(first.orderId, 'SUCCEEDED'))).status).toBe(200);
    const res = await createCheckout(user, 'another-key-01');
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('PAYMENT_ALREADY_EXISTS');
  });
});

describe('POST /webhooks/payments/:gateway', () => {
  it('SUCCEEDED → payment, CHARGE + VOUCHER_ISSUE, RESERVED voucher, outbox events — one transaction', async () => {
    const user = newId<'User'>();
    const c = await checkout(user);
    clock.advance({ minutes: 2 });
    const res = await deliver(gateway.simulatePayment(c.orderId, 'SUCCEEDED'));
    expect(res.status).toBe(200);
    expect(webhookAckResponseSchema.parse(await res.json())).toEqual({
      received: true,
      outcome: 'SUCCEEDED',
    });

    const pay = await database.pool.query(
      'select status, gateway_txn_id, succeeded_at from billing.payments where id = $1',
      [c.paymentId],
    );
    expect(pay.rows[0]).toMatchObject({ status: 'SUCCEEDED', succeeded_at: clock.now() });
    expect(pay.rows[0].gateway_txn_id).toMatch(/^fake_txn_/);

    const ledger = await database.pool.query(
      `select type, amount::text as amount, user_id, payment_id, voucher_id
         from billing.ledger_entries order by type`,
    );
    const voucher = await database.pool.query(
      'select id, status, value::text as value, expires_at, partner_id from billing.vouchers where payment_id = $1',
      [c.paymentId],
    );
    expect(voucher.rows).toEqual([
      {
        id: expect.any(String),
        status: 'RESERVED',
        value: String(VOUCHER_VND),
        expires_at: null,
        partner_id: null,
      },
    ]);
    expect(ledger.rows).toEqual([
      {
        type: 'CHARGE',
        amount: String(DEPOSIT_VND),
        user_id: user,
        payment_id: c.paymentId,
        voucher_id: null,
      },
      {
        type: 'VOUCHER_ISSUE',
        amount: String(VOUCHER_VND),
        user_id: user,
        payment_id: c.paymentId,
        voucher_id: voucher.rows[0].id,
      },
    ]);
    const outbox = await database.pool.query(
      'select event_type, aggregate_id from platform.outbox order by event_type',
    );
    expect(outbox.rows).toEqual([
      { event_type: 'PaymentSucceeded', aggregate_id: c.paymentId },
      { event_type: 'VoucherIssued', aggregate_id: voucher.rows[0].id },
    ]);
    expect(await billing.facade.hasPaidVerification(user)).toBe(true);
  });

  it('the same webhook sent 3 times sequentially → 1 ledger set + 1 voucher (AC1)', async () => {
    const c = await checkout(newId<'User'>());
    const hook = gateway.simulatePayment(c.orderId, 'SUCCEEDED');
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await deliver(hook);
      expect(res.status).toBe(200);
      outcomes.push(webhookAckResponseSchema.parse(await res.json()).outcome);
    }
    expect(outcomes).toEqual(['SUCCEEDED', 'DUPLICATE', 'DUPLICATE']);
    expect(await counts()).toEqual({ payments: 1, succeeded: 1, ledger: 2, vouchers: 1, outbox: 2 });
  });

  it('the same webhook sent 3 times concurrently → 1 ledger set + 1 voucher (AC1)', async () => {
    const c = await checkout(newId<'User'>());
    const hook = gateway.simulatePayment(c.orderId, 'SUCCEEDED');
    const results = await runConcurrently(3, () => deliver(hook));
    const outcomes = await Promise.all(
      results.map(async (r) => {
        if (r.status !== 'fulfilled') throw r.reason;
        expect(r.value.status).toBe(200);
        return webhookAckResponseSchema.parse(await r.value.json()).outcome;
      }),
    );
    expect(outcomes.sort()).toEqual(['DUPLICATE', 'DUPLICATE', 'SUCCEEDED']);
    expect(await counts()).toEqual({ payments: 1, succeeded: 1, ledger: 2, vouchers: 1, outbox: 2 });
  });

  it('wrong signature → 401 WEBHOOK_INVALID and no new row anywhere (AC3)', async () => {
    const c = await checkout(newId<'User'>());
    const hook = gateway.simulatePayment(c.orderId, 'SUCCEEDED');
    const before = await counts();

    const forged = await deliver({
      headers: { ...hook.headers, [FAKE_SIGNATURE_HEADER]: 'ab'.repeat(32) },
      rawBody: hook.rawBody,
    });
    expect(forged.status).toBe(401);
    expect(await code(forged)).toBe('WEBHOOK_INVALID');
    const tampered = await deliver({
      headers: hook.headers,
      rawBody: hook.rawBody.replace('SUCCEEDED', 'FAILED'),
    });
    expect(tampered.status).toBe(401);
    const { [FAKE_SIGNATURE_HEADER]: _sig, ...unsigned } = hook.headers;
    expect((await deliver({ headers: unsigned, rawBody: hook.rawBody })).status).toBe(401);

    expect(await counts()).toEqual(before);
    const { rows } = await database.pool.query('select status from billing.payments where id = $1', [
      c.paymentId,
    ]);
    expect(rows).toEqual([{ status: 'PENDING' }]);
  });

  it('webhook for a gateway other than the configured one → 404', async () => {
    const c = await checkout(newId<'User'>());
    const hook = gateway.simulatePayment(c.orderId, 'SUCCEEDED');
    const res = await app.request('/webhooks/payments/payos', {
      method: 'POST',
      headers: hook.headers,
      body: hook.rawBody,
    });
    expect(res.status).toBe(404);
    expect(await counts()).toMatchObject({ succeeded: 0, ledger: 0 });
  });

  it('FAILED → payment FAILED + PaymentFailed; a new checkout is then allowed', async () => {
    const user = newId<'User'>();
    const c = await checkout(user);
    const res = await deliver(gateway.simulatePayment(c.orderId, 'FAILED'));
    expect(webhookAckResponseSchema.parse(await res.json()).outcome).toBe('FAILED');
    const { rows } = await database.pool.query('select status, failure_reason from billing.payments');
    expect(rows).toEqual([{ status: 'FAILED', failure_reason: 'GATEWAY_REPORTED_FAILURE' }]);
    expect((await database.pool.query('select event_type from platform.outbox')).rows).toEqual([
      { event_type: 'PaymentFailed' },
    ]);

    const next = await createCheckout(user, 'retry-key-0001');
    expect(next.status).toBe(201);
    expect(verificationCheckoutResponseSchema.parse(await next.json()).paymentId).not.toBe(c.paymentId);
  });

  it('amount mismatch → 200 AMOUNT_MISMATCH, nothing applied, error logged without PII', async () => {
    const user = newId<'User'>();
    const c = await checkout(user);
    await gateway.createCheckout(c.orderId, 1_000n, 'tamgiao://payments/return');
    const res = await deliver(gateway.simulatePayment(c.orderId, 'SUCCEEDED'));
    expect(webhookAckResponseSchema.parse(await res.json()).outcome).toBe('AMOUNT_MISMATCH');
    expect(await counts()).toMatchObject({ succeeded: 0, ledger: 0, vouchers: 0, outbox: 0 });
    const line = logLines.find((l) => l.includes('payment webhook not applied'));
    expect(line).toBeDefined();
    expect(JSON.parse(line ?? '{}')).toMatchObject({
      level: 50,
      outcome: 'AMOUNT_MISMATCH',
      orderId: c.orderId,
    });
    expect(line).not.toContain(user);
  });

  it('unknown order → 200 UNKNOWN_ORDER, nothing written', async () => {
    await gateway.createCheckout('VPDOESNOTEXIST', BigInt(DEPOSIT_VND), 'tamgiao://payments/return');
    const res = await deliver(gateway.simulatePayment('VPDOESNOTEXIST', 'SUCCEEDED'));
    expect(res.status).toBe(200);
    expect(webhookAckResponseSchema.parse(await res.json()).outcome).toBe('UNKNOWN_ORDER');
    expect(await counts()).toEqual({ payments: 0, succeeded: 0, ledger: 0, vouchers: 0, outbox: 0 });
  });
});

describe('GET /me/payments', () => {
  it('lists the user payments newest first with status; checkout only while PENDING', async () => {
    const user = newId<'User'>();
    const first = await checkout(user);
    await deliver(gateway.simulatePayment(first.orderId, 'FAILED'));
    clock.advance({ minutes: 1 });
    const second = await checkout(user);

    const res = await app.request('/me/payments', { headers: { 'x-test-user': user } });
    expect(res.status).toBe(200);
    const body = paymentHistoryResponseSchema.parse(await res.json());
    expect(body.items.map((p) => [p.paymentId, p.status, p.amountVnd])).toEqual([
      [second.paymentId, 'PENDING', DEPOSIT_VND],
      [first.paymentId, 'FAILED', DEPOSIT_VND],
    ]);
    expect(body.items[0]).toMatchObject({
      checkoutUrl: second.checkoutUrl,
      qrData: second.qrData,
      failedAt: null,
    });
    expect(body.items[1]).toMatchObject({ checkoutUrl: null, qrData: null, failedAt: T0.toISOString() });

    const other = await app.request('/me/payments', { headers: { 'x-test-user': newId() } });
    expect(paymentHistoryResponseSchema.parse(await other.json())).toEqual({ items: [] });
  });
});

describe('POST /dev/payments/fake/:orderId', () => {
  it('simulates the payment through the real webhook use case', async () => {
    const user = newId<'User'>();
    const c = await checkout(user);
    const res = await app.request(`/dev/payments/fake/${c.orderId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'SUCCEEDED' }),
    });
    expect(res.status).toBe(200);
    expect(webhookAckResponseSchema.parse(await res.json()).outcome).toBe('SUCCEEDED');
    expect(await billing.facade.hasPaidVerification(user)).toBe(true);
  });

  it('unknown order → 404; not mounted without a simulator', async () => {
    const unknown = await app.request('/dev/payments/fake/VPNOPE', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'SUCCEEDED' }),
    });
    expect(unknown.status).toBe(404);

    const c = await checkout(newId<'User'>());
    const res = await appWithoutDev.request(`/dev/payments/fake/${c.orderId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'SUCCEEDED' }),
    });
    expect(res.status).toBe(404);
    expect(await counts()).toMatchObject({ succeeded: 0 });
  });
});

describe('database constraints', () => {
  it('ledger_entries is append-only: UPDATE and DELETE are rejected', async () => {
    const c = await checkout(newId<'User'>());
    await deliver(gateway.simulatePayment(c.orderId, 'SUCCEEDED'));
    await expect(database.pool.query('update billing.ledger_entries set amount = 1')).rejects.toThrow(
      /append-only/,
    );
    await expect(database.pool.query('delete from billing.ledger_entries')).rejects.toThrow(/append-only/);
    expect(await counts()).toMatchObject({ ledger: 2 });
  });

  it('partial unique index: a second PENDING/SUCCEEDED payment for the same user is rejected (A10)', async () => {
    const user = newId<'User'>();
    await checkout(user);
    const insert = (status: string, key: string) =>
      database.pool.query(
        `insert into billing.payments (id, order_id, user_id, amount, status, idempotency_key, gateway_txn_id,
                                       created_at, updated_at, version)
         values ($1, $2, $3, 299000, $4, $5, $6, now(), now(), 0)`,
        [
          newId(),
          `VP${newId()}`,
          user,
          status,
          key,
          status === 'PENDING' || status === 'FAILED' ? null : `t-${key}`,
        ],
      );
    await expect(insert('PENDING', 'db-key-0001')).rejects.toMatchObject({
      code: '23505',
      constraint: 'payments_active_per_user_uq',
    });
    await expect(insert('SUCCEEDED', 'db-key-0002')).rejects.toMatchObject({ code: '23505' });
    await expect(insert('FAILED', 'db-key-0003')).resolves.toBeDefined();
  });
});
