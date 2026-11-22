import { createLogger } from '@tamgiao/config';
import {
  CHECK_IN_LOCATION_RETENTION_HOURS,
  CHECK_IN_OVERDUE_MINUTES,
} from '@tamgiao/contracts/constants';
import {
  VOUCHER_REDEEMED,
  datePlanSchema,
  myCheckInResponseSchema,
  problemSchema,
  safetyCheckInSchema,
} from '@tamgiao/contracts';
import {
  DrizzleUnitOfWork,
  EventBus,
  LocalKeyEncryptor,
  createDatabase,
  deliverOnce,
  type Database,
} from '@tamgiao/db';
import { handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { addDuration, FakeClock, newId, type DomainEvent } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECK_IN_LOCATION_PURGE_QUEUE,
  CHECK_IN_ON_VOUCHER_REDEEMED_CONSUMER,
  CHECK_IN_OVERDUE_QUEUE,
  createDatingModule,
  createDatingWorker,
} from '../index.js';
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
const encryptor = new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const module = createDatingModule({
    uow,
    clock,
    scheduler,
    encryptor,
    requireUser,
    matching,
    partners,
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

async function confirmed(pair: Pair, startsAt = STARTS): Promise<string> {
  const res = await post('/me/dates', pair.a, proposeBody(pair, startsAt));
  expect(res.status).toBe(201);
  const planId = datePlanSchema.parse(await res.json()).id;
  const confRes = await post(`/me/dates/${planId}/confirm`, pair.b);
  expect(confRes.status).toBe(200);
  return planId;
}

async function outboxEvents(aggregateId?: string) {
  const query = aggregateId
    ? `select id, event_type, aggregate_type, aggregate_id, aggregate_version, payload, occurred_at
         from platform.outbox where aggregate_id = $1 order by occurred_at, aggregate_version`
    : `select id, event_type, aggregate_type, aggregate_id, aggregate_version, payload, occurred_at
         from platform.outbox order by occurred_at, aggregate_version`;
  const { rows } = await sql(query, aggregateId ? [aggregateId] : []);
  return rows as {
    id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    aggregate_version: number;
    payload: Record<string, unknown>;
    occurred_at: Date;
  }[];
}

describe('Safety Check-In (BE-S7-02)', () => {
  it('check-in thủ công trong khung giờ có location → 201, date_plans = CHECKED_IN, 1 check-in, 1 location mã hoá, outbox, jobs', async () => {
    const pair = datingPair();
    const planId = await confirmed(pair);
    const checkInTime = addDuration(STARTS, { minutes: 10 });
    clock.set(checkInTime);

    const res = await post(`/me/dates/${planId}/check-in`, pair.a, {
      location: { latitude: 21.0285, longitude: 105.8542, accuracyMeters: 15 },
    });
    expect(res.status).toBe(201);
    const dto = safetyCheckInSchema.parse(await res.json());
    expect(dto).toMatchObject({
      datePlanId: planId,
      source: 'MANUAL',
      locationShared: true,
      checkedOutAt: null,
      overdueAlertedAt: null,
    });

    // date_plans chuyển sang CHECKED_IN
    const { rows: planRows } = await sql('select status from dating.date_plans where id = $1', [planId]);
    expect(planRows[0]?.status).toBe('CHECKED_IN');

    // 1 dòng safety_check_ins
    const { rows: checkInRows } = await sql(
      'select * from dating.safety_check_ins where date_plan_id = $1 and user_id = $2',
      [planId, pair.a],
    );
    expect(checkInRows.length).toBe(1);
    expect(checkInRows[0]?.location_shared).toBe(true);
    expect(checkInRows[0]?.source).toBe('MANUAL');

    // 1 dòng check_in_locations với location_enc khác plaintext
    const { rows: locRows } = await sql(
      'select * from dating.check_in_locations where check_in_id = $1',
      [dto.id],
    );
    expect(locRows.length).toBe(1);
    const locationEnc = locRows[0]?.location_enc as Buffer;
    expect(Buffer.isBuffer(locationEnc)).toBe(true);
    const rawEncString = locationEnc.toString('utf-8');
    expect(rawEncString.includes('21.0285')).toBe(false);
    expect(rawEncString.includes('105.8542')).toBe(false);

    // Outbox có DateCheckedIn + DateParticipantCheckedIn
    const events = await outboxEvents();
    const types = events.map((e) => e.event_type);
    expect(types).toContain('DateCheckedIn');
    expect(types).toContain('DateParticipantCheckedIn');

    // Scheduler có job CHECK_IN_OVERDUE_QUEUE và CHECK_IN_LOCATION_PURGE_QUEUE
    const overdueJob = scheduler.jobs.find(
      (j) => j.queue === CHECK_IN_OVERDUE_QUEUE && j.key === dto.id,
    );
    expect(overdueJob).toBeDefined();
    expect(overdueJob?.runAt.toISOString()).toBe(
      addDuration(ENDS, { minutes: CHECK_IN_OVERDUE_MINUTES }).toISOString(),
    );

    const purgeJob = scheduler.jobs.find(
      (j) => j.queue === CHECK_IN_LOCATION_PURGE_QUEUE && j.key === dto.id,
    );
    expect(purgeJob).toBeDefined();
    expect(purgeJob?.runAt.toISOString()).toBe(
      addDuration(checkInTime, { hours: CHECK_IN_LOCATION_RETENTION_HOURS }).toISOString(),
    );
  });

  it('lỗi check-in: lần 2 → 409, ngoài khung giờ → 409, người ngoài → 403, location sai → 422', async () => {
    const pair = datingPair();
    const planId = await confirmed(pair);
    clock.set(addDuration(STARTS, { minutes: 10 }));

    // Check-in lần đầu thành công
    const res1 = await post(`/me/dates/${planId}/check-in`, pair.a, {});
    expect(res1.status).toBe(201);

    // Check-in lần 2 → 409 DATE_ALREADY_CHECKED_IN
    const res2 = await post(`/me/dates/${planId}/check-in`, pair.a, {});
    expect(res2.status).toBe(409);
    expect(await code(res2)).toBe('DATE_ALREADY_CHECKED_IN');

    // Ngoài khung giờ → 409 DATE_CHECK_IN_WINDOW_CLOSED
    clock.set(T0);
    const pair2 = datingPair();
    const planId2 = await confirmed(pair2);
    clock.set(addDuration(STARTS, { minutes: -10 })); // trước giờ hẹn
    const resBefore = await post(`/me/dates/${planId2}/check-in`, pair2.a, {});
    expect(resBefore.status).toBe(409);
    expect(await code(resBefore)).toBe('DATE_CHECK_IN_WINDOW_CLOSED');

    // Người ngoài → 403 NOT_PARTICIPANT
    clock.set(addDuration(STARTS, { minutes: 10 }));
    const outsider = newId();
    const resOutsider = await post(`/me/dates/${planId2}/check-in`, outsider, {});
    expect(resOutsider.status).toBe(403);
    expect(await code(resOutsider)).toBe('NOT_PARTICIPANT');

    // Location sai (latitude 91) → 422 VALIDATION_FAILED
    const resBadLoc = await post(`/me/dates/${planId2}/check-in`, pair2.a, {
      location: { latitude: 91, longitude: 105.8542 },
    });
    expect(resBadLoc.status).toBe(422);
    expect(await code(resBadLoc)).toBe('VALIDATION_FAILED');
  });

  it('hai request check-in đồng thời cùng người → đúng 1 thành công, 1 dòng', async () => {
    const pair = datingPair();
    const planId = await confirmed(pair);
    clock.set(addDuration(STARTS, { minutes: 15 }));

    const results = await runConcurrently(2, async (): Promise<Response> => post(`/me/dates/${planId}/check-in`, pair.a, {}));
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)).sort();
    expect(statuses).toEqual([201, 409]);

    const { rows } = await sql(
      'select count(*)::int as cnt from dating.safety_check_ins where date_plan_id = $1 and user_id = $2',
      [planId, pair.a],
    );
    expect(rows[0]?.cnt).toBe(1);
  });

  it('AC1: vị trí tự xoá sau CHECK_IN_LOCATION_RETENTION_HOURS giờ; check-in vẫn còn với location_shared = true', async () => {
    const pair = datingPair();
    const planId = await confirmed(pair);
    const checkInTime = addDuration(STARTS, { minutes: 5 });
    clock.set(checkInTime);

    const res = await post(`/me/dates/${planId}/check-in`, pair.a, {
      location: { latitude: 21.0, longitude: 105.8 },
    });
    expect(res.status).toBe(201);
    const dto = safetyCheckInSchema.parse(await res.json());

    const worker = createDatingWorker({ uow, clock, scheduler, encryptor });

    // Tới trước hạn xoá 1 giờ → purged = 0, dòng vẫn còn
    clock.set(addDuration(checkInTime, { hours: CHECK_IN_LOCATION_RETENTION_HOURS - 1 }));
    const r1 = await worker.purgeCheckInLocations.execute();
    expect(r1.purged).toBe(0);
    const { rows: rowsBefore } = await sql(
      'select count(*)::int as cnt from dating.check_in_locations where check_in_id = $1',
      [dto.id],
    );
    expect(rowsBefore[0]?.cnt).toBe(1);

    // Tới đúng hạn xoá → purged = 1, dòng bị xoá
    clock.set(addDuration(checkInTime, { hours: CHECK_IN_LOCATION_RETENTION_HOURS }));
    const r2 = await worker.purgeCheckInLocations.execute();
    expect(r2.purged).toBe(1);
    const { rows: rowsAfter } = await sql(
      'select count(*)::int as cnt from dating.check_in_locations where check_in_id = $1',
      [dto.id],
    );
    expect(rowsAfter[0]?.cnt).toBe(0);

    // Chạy lại → purged = 0 (idempotent)
    const r3 = await worker.purgeCheckInLocations.execute();
    expect(r3.purged).toBe(0);

    // Check-in vẫn còn với location_shared = true
    const { rows: checkInRows } = await sql(
      'select location_shared from dating.safety_check_ins where id = $1',
      [dto.id],
    );
    expect(checkInRows[0]?.location_shared).toBe(true);
  });

  it('AC2: cảnh báo quá hạn check-out sau CHECK_IN_OVERDUE_MINUTES phút', async () => {
    const pair = datingPair();
    const planId = await confirmed(pair);
    clock.set(STARTS);

    const res = await post(`/me/dates/${planId}/check-in`, pair.a, {});
    expect(res.status).toBe(201);
    const checkInId = safetyCheckInSchema.parse(await res.json()).id;

    const worker = createDatingWorker({ uow, clock, scheduler, encryptor });

    // clock = endsAt + 59 phút → NOT_YET_DUE
    clock.set(addDuration(ENDS, { minutes: CHECK_IN_OVERDUE_MINUTES - 1 }));
    const o1 = await worker.markCheckInOverdue.execute({ checkInId });
    expect(o1.kind).toBe('NOT_YET_DUE');

    // clock = endsAt + 60 phút → ALERTED, outbox có đúng 1 DateCheckInOverdue
    clock.set(addDuration(ENDS, { minutes: CHECK_IN_OVERDUE_MINUTES }));
    const o2 = await worker.markCheckInOverdue.execute({ checkInId });
    expect(o2.kind).toBe('ALERTED');

    const overdueEvents1 = (await outboxEvents(checkInId)).filter(
      (e) => e.event_type === 'DateCheckInOverdue',
    );
    expect(overdueEvents1.length).toBe(1);

    // Chạy lại → ALREADY_ALERTED, outbox vẫn đúng 1 event
    const o3 = await worker.markCheckInOverdue.execute({ checkInId });
    expect(o3.kind).toBe('ALREADY_ALERTED');
    const overdueEvents2 = (await outboxEvents(checkInId)).filter(
      (e) => e.event_type === 'DateCheckInOverdue',
    );
    expect(overdueEvents2.length).toBe(1);

    // Check-in khác đã check-out → CHECKED_OUT, không phát event
    clock.set(T0);
    const pairB = datingPair();
    const planIdB = await confirmed(pairB);
    clock.set(STARTS);
    const resB = await post(`/me/dates/${planIdB}/check-in`, pairB.a, {});
    const checkInIdB = safetyCheckInSchema.parse(await resB.json()).id;
    await post(`/me/dates/${planIdB}/check-out`, pairB.a);

    clock.set(addDuration(ENDS, { minutes: CHECK_IN_OVERDUE_MINUTES + 10 }));
    const oB = await worker.markCheckInOverdue.execute({ checkInId: checkInIdB });
    expect(oB.kind).toBe('CHECKED_OUT');
    const overdueEventsB = (await outboxEvents(checkInIdB)).filter(
      (e) => e.event_type === 'DateCheckInOverdue',
    );
    expect(overdueEventsB.length).toBe(0);
  });

  it('check-out & GET /me/dates/:id/check-in', async () => {
    const pair = datingPair();
    const planId = await confirmed(pair);

    // GET trước khi check-in → { checkIn: null }
    const getBefore = await get(`/me/dates/${planId}/check-in`, pair.a);
    expect(getBefore.status).toBe(200);
    expect(myCheckInResponseSchema.parse(await getBefore.json())).toEqual({ checkIn: null });

    // Check-out trước khi check-in → 409 DATE_NOT_CHECKED_IN
    const checkOutBefore = await post(`/me/dates/${planId}/check-out`, pair.a);
    expect(checkOutBefore.status).toBe(409);
    expect(await code(checkOutBefore)).toBe('DATE_NOT_CHECKED_IN');

    // Check-in
    clock.set(addDuration(STARTS, { minutes: 15 }));
    const checkInRes = await post(`/me/dates/${planId}/check-in`, pair.a, {
      location: { latitude: 21.0, longitude: 105.8 },
    });
    expect(checkInRes.status).toBe(201);

    // GET sau khi check-in → có dữ liệu, không có trường vị trí
    const getAfter = await get(`/me/dates/${planId}/check-in`, pair.a);
    expect(getAfter.status).toBe(200);
    const getBody = (await getAfter.json()) as { checkIn: Record<string, unknown> | null };
    const parsedGet = myCheckInResponseSchema.parse(getBody);
    expect(parsedGet.checkIn).not.toBeNull();
    expect(parsedGet.checkIn?.locationShared).toBe(true);
    expect(parsedGet.checkIn?.checkedOutAt).toBeNull();
    expect('location' in (getBody.checkIn ?? {})).toBe(false);

    // Check-out → 200 checkedOutAt
    const checkOutRes = await post(`/me/dates/${planId}/check-out`, pair.a);
    expect(checkOutRes.status).toBe(200);
    const dtoOut = safetyCheckInSchema.parse(await checkOutRes.json());
    expect(dtoOut.checkedOutAt).not.toBeNull();

    // Check-out lần 2 → 409 DATE_NOT_CHECKED_IN
    const checkOutAgain = await post(`/me/dates/${planId}/check-out`, pair.a);
    expect(checkOutAgain.status).toBe(409);
    expect(await code(checkOutAgain)).toBe('DATE_NOT_CHECKED_IN');
  });

  it('Consumer VoucherRedeemed: tạo check-in nguồn VOUCHER, idempotent, lọc ngoài khung giờ / sai partner', async () => {
    const pair = datingPair();
    const planId = await confirmed(pair);

    const workerBus = new EventBus();
    const datingWorker = createDatingWorker({ uow, clock, scheduler, encryptor });
    datingWorker.registerConsumers(workerBus);

    const sub = workerBus.list().find((x) => x.consumer === CHECK_IN_ON_VOUCHER_REDEEMED_CONSUMER);
    if (!sub) throw new Error('thiếu consumer');

    const voucherEvent: DomainEvent = {
      eventId: newId(),
      type: VOUCHER_REDEEMED,
      aggregateType: 'Voucher',
      aggregateId: newId(),
      version: 1,
      occurredAt: addDuration(STARTS, { minutes: 20 }),
      payload: {
        voucherId: newId(),
        userId: pair.a,
        partnerId: pair.partnerId,
        valueVnd: 300_000,
      },
    };

    // Giao event trong khung giờ → safety_check_ins nguồn VOUCHER, lịch CHECKED_IN
    const delivered = await deliverOnce(uow, sub, voucherEvent);
    expect(delivered).toBe(true);

    const { rows: vRows } = await sql(
      'select source from dating.safety_check_ins where date_plan_id = $1 and user_id = $2',
      [planId, pair.a],
    );
    expect(vRows.length).toBe(1);
    expect(vRows[0]?.source).toBe('VOUCHER');

    const { rows: planRows } = await sql('select status from dating.date_plans where id = $1', [planId]);
    expect(planRows[0]?.status).toBe('CHECKED_IN');

    // Giao lại cùng event → không thêm dòng (idempotent qua deliverOnce)
    const reDelivered = await deliverOnce(uow, sub, voucherEvent);
    expect(reDelivered).toBe(false);

    // Event cùng eventId mới nhưng người dùng đã check-in → không thêm dòng
    const repeatEvent: DomainEvent = { ...voucherEvent, eventId: newId() };
    const repeated = await deliverOnce(uow, sub, repeatEvent);
    expect(repeated).toBe(true);
    const { rows: countRows } = await sql(
      'select count(*)::int as cnt from dating.safety_check_ins where date_plan_id = $1 and user_id = $2',
      [planId, pair.a],
    );
    expect(countRows[0]?.cnt).toBe(1);

    // Event occurredAt ngoài khung giờ → không thêm dòng
    const pairOut = datingPair();
    const planOut = await confirmed(pairOut);
    const outsideEvent: DomainEvent = {
      ...voucherEvent,
      eventId: newId(),
      occurredAt: addDuration(STARTS, { hours: -5 }),
      payload: {
        voucherId: newId(),
        userId: pairOut.a,
        partnerId: pairOut.partnerId,
        valueVnd: 300_000,
      },
    };
    await deliverOnce(uow, sub, outsideEvent);
    const { rows: outRows } = await sql(
      'select count(*)::int as cnt from dating.safety_check_ins where date_plan_id = $1',
      [planOut],
    );
    expect(outRows[0]?.cnt).toBe(0);

    // Event partnerId khác → không thêm dòng
    const diffPartnerEvent: DomainEvent = {
      ...voucherEvent,
      eventId: newId(),
      occurredAt: addDuration(STARTS, { minutes: 10 }),
      payload: {
        voucherId: newId(),
        userId: pairOut.a,
        partnerId: newId(),
        valueVnd: 300_000,
      },
    };
    await deliverOnce(uow, sub, diffPartnerEvent);
    const { rows: diffRows } = await sql(
      'select count(*)::int as cnt from dating.safety_check_ins where date_plan_id = $1',
      [planOut],
    );
    expect(diffRows[0]?.cnt).toBe(0);
  });
});
