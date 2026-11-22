import { createLogger } from '@tamgiao/config';
import {
  DATE_CONFIRMED,
  currentDatePlanResponseSchema,
  datePlanSchema,
  problemSchema,
} from '@tamgiao/contracts';
import { DATE_RESPONSE_TTL_HOURS, VOUCHER_TTL_DAYS } from '@tamgiao/contracts/constants';
import {
  createDatabase,
  deliverOnce,
  DrizzleUnitOfWork,
  EventBus,
  LocalKeyEncryptor,
  type Database,
} from '@tamgiao/db';
import { handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { addDuration, FakeClock, newId, type DomainEvent } from '@tamgiao/kernel';
import {
  ACTIVATE_VOUCHER_ON_DATE_CONFIRMED_CONSUMER,
  createBillingWorker,
  FakePaymentGateway,
} from '@tamgiao/module-billing';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DATE_PLAN_EXPIRY_QUEUE } from '../application/date-plan-expiry.js';
import { createDatingModule, createExpireDatePlanJob } from '../index.js';
import { FakeMatchingFacade, FakePartnerFacade, RecordingScheduler } from './dating-fakes.js';

const T0 = new Date('2026-12-01T02:00:00.000Z');
const STARTS = addDuration(T0, { days: 3 });
const ENDS = addDuration(STARTS, { hours: 2 });

let database: Database;
let uow: DrizzleUnitOfWork;
let app: Hono<AppEnv>;
const clock = new FakeClock(T0);
const scheduler = new RecordingScheduler();
const matching = new FakeMatchingFacade();
const partners = new FakePartnerFacade();

// Billing worker thật (consumer DateConfirmed) — chuỗi DateConfirmed → VoucherActivated trên Postgres thật.
const bus = new EventBus();
const voucherSub = () => {
  const s = bus.list().find((x) => x.consumer === ACTIVATE_VOUCHER_ON_DATE_CONFIRMED_CONSUMER);
  if (!s) throw new Error('missing consumer');
  return s;
};

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  createBillingWorker({
    uow,
    clock,
    paymentGateway: new FakePaymentGateway({ secret: 'dating-int-secret' }),
  }).registerConsumers(bus);
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const encryptor = new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  const module = createDatingModule({ uow, clock, scheduler, encryptor, requireUser, matching, partners });
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
  scheduler.jobs.length = 0;
});
afterAll(() => database.close());

const sql = (text: string, params: unknown[] = []) => database.pool.query(text, params);
const post = (path: string, userId: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': userId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const get = (path: string, userId: string) => app.request(path, { headers: { 'x-test-user': userId } });
const code = async (res: Response) => problemSchema.parse(await res.json()).code;

interface Pair {
  readonly matchId: string;
  readonly a: string;
  readonly b: string;
  readonly partnerId: string;
}
function datingPair(): Pair {
  const pair = { matchId: newId(), a: newId(), b: newId(), partnerId: newId() };
  matching.setMatch(pair.matchId, pair.a, pair.b, 'DATING');
  partners.active.add(pair.partnerId);
  return pair;
}

const proposeBody = (pair: Pair, startsAt = STARTS) => ({
  partnerId: pair.partnerId,
  startsAt: startsAt.toISOString(),
  endsAt: addDuration(startsAt, { hours: 2 }).toISOString(),
  staffBookingRequested: true,
});

async function proposed(pair: Pair, userId = pair.a): Promise<string> {
  const res = await post('/me/dates', userId, proposeBody(pair));
  expect(res.status).toBe(201);
  return datePlanSchema.parse(await res.json()).id;
}

async function outboxOf(aggregateId: string) {
  const { rows } = await sql(
    `select id, event_type, aggregate_version, payload, occurred_at
       from platform.outbox where aggregate_id = $1 order by aggregate_version`,
    [aggregateId],
  );
  return rows as {
    id: string;
    event_type: string;
    aggregate_version: number;
    payload: Record<string, unknown>;
    occurred_at: Date;
  }[];
}

/** Khoản thanh toán `SUCCEEDED` + voucher `RESERVED` đã có hạn dùng (hồ sơ duyệt lúc T0), như sau BE-S4-03/04. */
async function seedReservedVoucher(userId: string): Promise<string> {
  const paymentId = newId();
  const voucherId = newId();
  await sql(
    `insert into billing.payments (id, order_id, user_id, amount, status, gateway_txn_id, idempotency_key,
       created_at, succeeded_at, updated_at, version)
     values ($1, $2, $3, 299000, 'SUCCEEDED', $4, $5, $6, $6, $6, 2)`,
    [paymentId, `VP${paymentId.replaceAll('-', '')}`, userId, `txn_${paymentId}`, `key-${paymentId}`, T0],
  );
  await sql(
    `insert into billing.vouchers (id, user_id, payment_id, value, status, expires_at, issued_at, updated_at, version)
     values ($1, $2, $3, 300000, 'RESERVED', $4, $5, $5, 1)`,
    [voucherId, userId, paymentId, addDuration(T0, { days: VOUCHER_TTL_DAYS }), T0],
  );
  return voucherId;
}

describe('POST /me/dates (đề xuất lịch)', () => {
  it('201 PROPOSED: lưu dating.date_plans + outbox DateProposed + job hết hạn', async () => {
    const pair = datingPair();
    const res = await post('/me/dates', pair.a, proposeBody(pair));
    expect(res.status).toBe(201);
    const dto = datePlanSchema.parse(await res.json());
    expect(dto).toMatchObject({
      matchId: pair.matchId,
      inviterId: pair.a,
      inviteeId: pair.b,
      myRole: 'INVITER',
      partnerId: pair.partnerId,
      status: 'PROPOSED',
      staffBookingRequested: true,
      startsAt: STARTS.toISOString(),
      expiresAt: addDuration(T0, { hours: DATE_RESPONSE_TTL_HOURS }).toISOString(),
    });
    const { rows } = await sql(`select status, version from dating.date_plans where id = $1`, [dto.id]);
    expect(rows).toEqual([{ status: 'PROPOSED', version: 1 }]);
    expect((await outboxOf(dto.id)).map((e) => e.event_type)).toEqual(['DateProposed']);
    expect(scheduler.jobs).toEqual([
      {
        queue: DATE_PLAN_EXPIRY_QUEUE,
        key: `${dto.id}:1`,
        runAt: new Date(dto.expiresAt),
        payload: { datePlanId: dto.id },
      },
    ]);
  });

  it('AC1: match không ở DATING → 409 MATCH_NOT_DATING, không ghi gì', async () => {
    const pair = datingPair();
    matching.setMatch(pair.matchId, pair.a, pair.b, 'AWAITING_RESPONSE');
    const res = await post('/me/dates', pair.a, proposeBody(pair));
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('MATCH_NOT_DATING');
    expect((await sql(`select 1 from dating.date_plans`)).rowCount).toBe(0);
    expect(scheduler.jobs).toHaveLength(0);
  });

  it('quán đã tắt → 404 PARTNER_NOT_FOUND; body sai → 422', async () => {
    const pair = datingPair();
    partners.active.delete(pair.partnerId);
    const res = await post('/me/dates', pair.a, proposeBody(pair));
    expect(res.status).toBe(404);
    expect(await code(res)).toBe('PARTNER_NOT_FOUND');
    const invalid = await post('/me/dates', pair.a, { partnerId: pair.partnerId });
    expect(invalid.status).toBe(422);
  });

  it('A10: hai người đề xuất đồng thời → đúng 1 lịch, còn lại 409 DATE_ALREADY_OPEN', async () => {
    const pair = datingPair();
    const results = await runConcurrently(6, async (i): Promise<Response> =>
      post('/me/dates', i % 2 === 0 ? pair.a : pair.b, proposeBody(pair)),
    );
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.status === 409) expect(await code(r.value)).toBe('DATE_ALREADY_OPEN');
    }
    expect((await sql(`select 1 from dating.date_plans where match_id = $1`, [pair.matchId])).rowCount).toBe(1);
    expect(scheduler.jobs).toHaveLength(1);
  });

  it('DB chặn lịch mở thứ hai của cùng match (partial unique index)', async () => {
    const pair = datingPair();
    await proposed(pair);
    await expect(
      sql(
        `insert into dating.date_plans (id, match_id, inviter_id, invitee_id, partner_id, starts_at, ends_at, status,
           proposed_at, expires_at, updated_at, version)
         values ($1, $2, $3, $4, $5, $6, $7, 'CONFIRMED', $8, $9, $8, 2)`,
        [newId(), pair.matchId, pair.b, pair.a, pair.partnerId, STARTS, ENDS, T0, addDuration(T0, { hours: 1 })],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'date_plans_open_per_match_uq' });
  });
});

describe('xác nhận → DateConfirmed → voucher ACTIVE (AC2)', () => {
  it('chuỗi DateConfirmed → VoucherActivated cho người mời, giao lại event không đổi gì', async () => {
    const pair = datingPair();
    const voucherId = await seedReservedVoucher(pair.a);
    const inviteeVoucher = await seedReservedVoucher(pair.b);
    const id = await proposed(pair);

    clock.advance({ hours: 2 });
    const res = await post(`/me/dates/${id}/confirm`, pair.b);
    expect(res.status).toBe(200);
    expect(datePlanSchema.parse(await res.json())).toMatchObject({ status: 'CONFIRMED', myRole: 'INVITEE' });

    const outbox = await outboxOf(id);
    expect(outbox.map((e) => e.event_type)).toEqual(['DateProposed', 'DateConfirmed']);
    const row = outbox[1];
    if (!row) throw new Error('missing DateConfirmed');
    expect(row.payload).toEqual({
      datePlanId: id,
      matchId: pair.matchId,
      inviterId: pair.a,
      inviteeId: pair.b,
      partnerId: pair.partnerId,
      startsAt: STARTS.toISOString(),
      endsAt: ENDS.toISOString(),
      staffBookingRequested: true,
    });

    // Relay giao event từ outbox cho consumer billing (như OutboxRelay → hàng đợi consumer).
    const event: DomainEvent = {
      eventId: row.id,
      type: DATE_CONFIRMED,
      aggregateType: 'DatePlan',
      aggregateId: id,
      version: row.aggregate_version,
      occurredAt: row.occurred_at,
      payload: row.payload,
    };
    expect(await deliverOnce(uow, voucherSub(), event)).toBe(true);
    const vouchers = await sql(`select id, status, activated_at from billing.vouchers order by issued_at, id`);
    expect(vouchers.rows.find((v) => v.id === voucherId)).toMatchObject({ status: 'ACTIVE' });
    expect(vouchers.rows.find((v) => v.id === inviteeVoucher)).toMatchObject({ status: 'RESERVED' });
    const activated = await sql(
      `select payload from platform.outbox where event_type = 'VoucherActivated' and aggregate_id = $1`,
      [voucherId],
    );
    expect(activated.rows).toHaveLength(1);

    // Idempotent (A9): giao lại cùng event → processed_events chặn; event mới cùng nội dung → voucher đã ACTIVE, no-op.
    expect(await deliverOnce(uow, voucherSub(), event)).toBe(false);
    expect(await deliverOnce(uow, voucherSub(), { ...event, eventId: newId() })).toBe(true);
    const again = await sql(`select 1 from platform.outbox where event_type = 'VoucherActivated'`);
    expect(again.rowCount).toBe(1);
  });

  it('người mời tự xác nhận → 403 DATE_NOT_INVITEE; người ngoài → 403 NOT_PARTICIPANT; id sai → 400', async () => {
    const pair = datingPair();
    const id = await proposed(pair);
    const own = await post(`/me/dates/${id}/confirm`, pair.a);
    expect([own.status, await code(own)]).toEqual([403, 'DATE_NOT_INVITEE']);
    const stranger = await post(`/me/dates/${id}/confirm`, newId());
    expect([stranger.status, await code(stranger)]).toEqual([403, 'NOT_PARTICIPANT']);
    const bad = await post(`/me/dates/not-a-uuid/decline`, pair.b);
    expect([bad.status, await code(bad)]).toEqual([400, 'INVALID_ID']);
  });
});

describe('hết hạn xác nhận (AC3)', () => {
  it('quá 24h không xác nhận → job → EXPIRED + DateExpired; đề xuất lịch mới được; job chạy lại no-op', async () => {
    const pair = datingPair();
    const id = await proposed(pair);
    const expirer = createExpireDatePlanJob({ uow, clock });

    expect(await expirer.execute({ datePlanId: id })).toEqual({ kind: 'NOT_YET_EXPIRED', status: 'PROPOSED' });
    clock.advance({ hours: DATE_RESPONSE_TTL_HOURS });
    const late = await post(`/me/dates/${id}/confirm`, pair.b);
    expect([late.status, await code(late)]).toEqual([409, 'DATE_RESPONSE_EXPIRED']);

    expect(await expirer.execute({ datePlanId: id })).toEqual({ kind: 'EXPIRED' });
    expect(await expirer.execute({ datePlanId: id })).toEqual({ kind: 'ALREADY_RESOLVED', status: 'EXPIRED' });
    expect((await outboxOf(id)).map((e) => e.event_type)).toEqual(['DateProposed', 'DateExpired']);

    const current = currentDatePlanResponseSchema.parse(await (await get('/me/dates/current', pair.b)).json());
    expect(current.datePlan).toMatchObject({ id, status: 'EXPIRED', myRole: 'INVITEE' });

    const next = await post('/me/dates', pair.b, proposeBody(pair, addDuration(STARTS, { days: 1 })));
    expect(next.status).toBe(201);
    const nextId = datePlanSchema.parse(await next.json()).id;
    const after = currentDatePlanResponseSchema.parse(await (await get('/me/dates/current', pair.a)).json());
    expect(after.datePlan).toMatchObject({ id: nextId, status: 'PROPOSED', myRole: 'INVITEE' });
  });
});

describe('huỷ lịch / từ chối', () => {
  it('huỷ trước 4h → CANCELLED + DateCancelled; quá mốc → 409 CANCEL_TOO_LATE', async () => {
    const first = datingPair();
    const id = await proposed(first);
    expect((await post(`/me/dates/${id}/confirm`, first.b)).status).toBe(200);
    clock.set(addDuration(STARTS, { hours: -4, milliseconds: 1 }));
    const late = await post(`/me/dates/${id}/cancel`, first.a);
    expect([late.status, await code(late)]).toEqual([409, 'CANCEL_TOO_LATE']);
    clock.set(addDuration(STARTS, { hours: -4 }));
    const ok = await post(`/me/dates/${id}/cancel`, first.b);
    expect(ok.status).toBe(200);
    expect(datePlanSchema.parse(await ok.json())).toMatchObject({ status: 'CANCELLED', cancelledBy: first.b });
    expect((await outboxOf(id)).map((e) => e.event_type)).toEqual([
      'DateProposed',
      'DateConfirmed',
      'DateCancelled',
    ]);
  });

  it('từ chối → DECLINED + DateDeclined; không có match mở → GET current null', async () => {
    const pair = datingPair();
    const id = await proposed(pair);
    const res = await post(`/me/dates/${id}/decline`, pair.b);
    expect(res.status).toBe(200);
    expect((await outboxOf(id)).map((e) => e.event_type)).toEqual(['DateProposed', 'DateDeclined']);
    const none = currentDatePlanResponseSchema.parse(await (await get('/me/dates/current', newId())).json());
    expect(none.datePlan).toBeNull();
  });
});
