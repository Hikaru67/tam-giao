import { createLogger } from '@tamgiao/config';
import {
  adminFeedbackDetailSchema,
  appearanceFlagQueueResponseSchema,
  myFeedbackResponseSchema,
  myFeedbackSchema,
  problemSchema,
} from '@tamgiao/contracts';
import { COOLDOWN_DAYS } from '@tamgiao/contracts/constants';
import {
  createDatabase,
  deliverOnce,
  DrizzleUnitOfWork,
  EventBus,
  LocalKeyEncryptor,
  type Database,
} from '@tamgiao/db';
import { createRequireAdmin, handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { addDuration, domainError, err, FakeClock, newId, ok, type DomainEvent } from '@tamgiao/kernel';
import { createMatchingWorker, MATCH_CLOSE_ON_FEEDBACK_SUBMITTED_CONSUMER } from '@tamgiao/module-matching';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatingModule } from '../index.js';
import { FakeMatchingFacade, FakePartnerFacade, RecordingScheduler } from './dating-fakes.js';
import { RecordingAuditLogger } from './feedback-fakes.js';

const T0 = new Date('2026-12-01T02:00:00.000Z');
const STARTS = addDuration(T0, { days: 2 });
const ENDS = addDuration(STARTS, { hours: 2 });

const REVIEWER = newId();
const MATCHMAKER = newId();

let database: Database;
let uow: DrizzleUnitOfWork;
let app: Hono<AppEnv>;
const clock = new FakeClock(T0);
const scheduler = new RecordingScheduler();
const matching = new FakeMatchingFacade();
const partners = new FakePartnerFacade();
const auditLogger = new RecordingAuditLogger();

// Bus matching thật — chuỗi FeedbackSubmitted → CloseMatch trên Postgres thật.
const bus = new EventBus();
createMatchingWorker({
  clock,
  profiles: { getMatchingProfile: async () => null },
  scheduler: { schedule: async () => undefined },
}).registerConsumers(bus);

const feedbackSub = () => {
  const s = bus.list().find((sub) => sub.consumer === MATCH_CLOSE_ON_FEEDBACK_SUBMITTED_CONSUMER);
  if (!s) throw new Error('missing MATCH_CLOSE_ON_FEEDBACK_SUBMITTED_CONSUMER');
  return s;
};

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
    if (token === 'reviewer') {
      return ok({
        adminId: REVIEWER,
        sessionId: newId(),
        role: 'REVIEWER',
        permissions: ['kyc:review'],
      });
    }
    if (token === 'matchmaker') {
      return ok({
        adminId: MATCHMAKER,
        sessionId: newId(),
        role: 'MATCHMAKER',
        permissions: ['match:propose'],
      });
    }
    return err(domainError('UNAUTHENTICATED'));
  });

  const module = createDatingModule({
    uow,
    clock,
    scheduler,
    encryptor: new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) }),
    requireUser,
    matching,
    partners,
    requireAdmin,
    auditLogger,
  });

  const logger = createLogger({ service: 'api', level: 'silent', destination: { write: () => undefined } });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(logger, { trustProxy: true }));
  app.route('/', module.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);
});

beforeEach(async () => {
  await resetDatabase(database.pool);
  clock.set(T0);
  scheduler.jobs.length = 0;
  auditLogger.entries.length = 0;
});

afterAll(() => database.close());

const post = (path: string, userId: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': userId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const get = (path: string, userId: string) => app.request(path, { headers: { 'x-test-user': userId } });

const asAdmin = (token: string | null, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const code = async (res: Response) => problemSchema.parse(await res.json()).code;

/** Match DATING giữa a, b + active_slots như seedDating trong user-banned.int.test.ts. */
async function seedDating(a: string, b: string): Promise<string> {
  const matchId = newId();
  const offeredAt = addDuration(T0, { days: -3 });
  await database.pool.query(
    `insert into matching.matches
       (id, user_a, user_b, created_by, status, accepted_by, offered_at, expires_at, dating_started_at, updated_at, version)
     values ($1, $2, $3, $4, 'DATING', $5, $6, $7, $6, $6, 3)`,
    [matchId, a, b, newId(), [a, b], offeredAt, addDuration(T0, { days: 10 })],
  );
  await database.pool.query(
    `insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $3, $4), ($2, $3, $4)`,
    [a, b, matchId, offeredAt],
  );
  return matchId;
}

/** Date plan CONFIRMED bằng SQL vào dating.date_plans theo đúng đặc tả. */
async function seedConfirmedDatePlan(matchId: string, a: string, b: string): Promise<string> {
  const datePlanId = newId();
  const partnerId = newId();
  const expiresAt = addDuration(T0, { hours: 1 });
  await database.pool.query(
    `insert into dating.date_plans
       (id, match_id, inviter_id, invitee_id, partner_id, starts_at, ends_at,
        staff_booking_requested, status, proposed_at, expires_at, responded_at, updated_at, version)
     values ($1, $2, $3, $4, $5, $6, $7, false, 'CONFIRMED', $8, $9, $8, $8, 2)`,
    [datePlanId, matchId, a, b, partnerId, STARTS, ENDS, T0, expiresAt],
  );
  return datePlanId;
}

interface OutboxFeedbackRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: Date;
  payload: unknown;
}

function rowToDomainEvent(row: OutboxFeedbackRow): DomainEvent {
  return {
    eventId: row.id,
    type: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    version: row.aggregate_version,
    occurredAt: new Date(row.occurred_at),
    payload: row.payload,
  };
}

async function deliverFeedbackEvents(): Promise<boolean[]> {
  const { rows } = await database.pool.query<OutboxFeedbackRow>(
    `select id, event_type, aggregate_type, aggregate_id, aggregate_version, occurred_at, payload
       from platform.outbox
      where event_type = 'FeedbackSubmitted'
      order by created_at, id`,
  );
  const results: boolean[] = [];
  for (const row of rows) {
    results.push(await deliverOnce(uow, feedbackSub(), rowToDomainEvent(row)));
  }
  return results;
}

describe('Đánh giá sau gặp mặt (BE-S7-03)', () => {
  it('AC1: a và b cùng POST decision A_COMMIT → outbox FeedbackSubmitted SUCCESS → deliver → CLOSED_SUCCESS, active_slots rỗng, không cooldown', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);
    const datePlanId = await seedConfirmedDatePlan(matchId, a, b);

    // Trước khi gửi feedback: buổi gặp đã diễn ra
    clock.set(addDuration(STARTS, { hours: 3 }));

    const resA = await post(`/me/dates/${datePlanId}/feedback`, a, {
      rating: 5,
      profileMatch: 'FULL_MATCH',
      feeling: 'DEEP_INTEREST',
      decision: 'A_COMMIT',
      stopReasons: [],
      stopNote: null,
    });
    expect(resA.status).toBe(201);

    // Chưa có event khi mới một người A_COMMIT (chờ người thứ hai)
    const interim = await database.pool.query(
      `select id from platform.outbox where event_type = 'FeedbackSubmitted'`,
    );
    expect(interim.rows).toHaveLength(0);

    const resB = await post(`/me/dates/${datePlanId}/feedback`, b, {
      rating: 4,
      profileMatch: 'MOSTLY_MATCH',
      feeling: 'DEEP_INTEREST',
      decision: 'A_COMMIT',
      stopReasons: [],
      stopNote: null,
    });
    expect(resB.status).toBe(201);

    const outboxEvents = await database.pool.query<OutboxFeedbackRow>(
      `select id, event_type, aggregate_type, aggregate_id, aggregate_version, occurred_at, payload
         from platform.outbox where event_type = 'FeedbackSubmitted'`,
    );
    expect(outboxEvents.rows).toHaveLength(1);
    expect(outboxEvents.rows[0]?.payload).toMatchObject({ matchId, outcome: 'SUCCESS' });

    const deliverResults = await deliverFeedbackEvents();
    expect(deliverResults).toEqual([true]);

    const { rows: matchRows } = await database.pool.query<{ status: string }>(
      `select status from matching.matches where id = $1`,
      [matchId],
    );
    expect(matchRows[0]?.status).toBe('CLOSED_SUCCESS');

    const { rows: slotRows } = await database.pool.query(
      `select * from matching.active_slots where match_id = $1`,
      [matchId],
    );
    expect(slotRows).toEqual([]);

    const { rows: cooldownRows } = await database.pool.query(
      `select * from matching.cooldowns where user_id in ($1, $2)`,
      [a, b],
    );
    expect(cooldownRows).toEqual([]);
  });

  it('AC2: chỉ a POST B_STOP → outbox FeedbackSubmitted STOPPED ngay → deliver → CLOSED_STOPPED, có cooldown; deliver lại no-op; sau đó b vẫn POST được 201', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);
    const datePlanId = await seedConfirmedDatePlan(matchId, a, b);

    clock.set(addDuration(STARTS, { hours: 3 }));

    const resA = await post(`/me/dates/${datePlanId}/feedback`, a, {
      rating: 3,
      profileMatch: 'MOSTLY_MATCH',
      feeling: 'NOT_A_FIT',
      decision: 'B_STOP',
      stopReasons: ['LIFESTYLE_DIFFERENCE'],
      stopNote: 'Khác biệt về định hướng lối sống',
    });
    expect(resA.status).toBe(201);

    const outboxEvents = await database.pool.query<OutboxFeedbackRow>(
      `select id, event_type, aggregate_type, aggregate_id, aggregate_version, occurred_at, payload
         from platform.outbox where event_type = 'FeedbackSubmitted'`,
    );
    expect(outboxEvents.rows).toHaveLength(1);
    expect(outboxEvents.rows[0]?.payload).toMatchObject({ matchId, outcome: 'STOPPED' });

    const event = rowToDomainEvent(outboxEvents.rows[0]!);
    expect(await deliverOnce(uow, feedbackSub(), event)).toBe(true);

    const { rows: matchRows } = await database.pool.query<{ status: string }>(
      `select status from matching.matches where id = $1`,
      [matchId],
    );
    expect(matchRows[0]?.status).toBe('CLOSED_STOPPED');

    const expectedUntil = addDuration(clock.now(), { days: COOLDOWN_DAYS });
    const { rows: cooldownRows } = await database.pool.query<{ user_id: string; until: Date }>(
      `select user_id, until from matching.cooldowns where user_id in ($1, $2) order by user_id`,
      [a, b],
    );
    expect(cooldownRows).toHaveLength(2);
    for (const row of cooldownRows) {
      expect(new Date(row.until).getTime()).toBe(expectedUntil.getTime());
    }

    // Deliver lại cùng event → false/no-op (processed_events), trạng thái giữ nguyên
    expect(await deliverOnce(uow, feedbackSub(), event)).toBe(false);
    const { rows: matchRowsAgain } = await database.pool.query<{ status: string }>(
      `select status from matching.matches where id = $1`,
      [matchId],
    );
    expect(matchRowsAgain[0]?.status).toBe('CLOSED_STOPPED');

    // Sau đó b vẫn POST được (201) và outbox vẫn chỉ 1 FeedbackSubmitted
    const resB = await post(`/me/dates/${datePlanId}/feedback`, b, {
      rating: 4,
      profileMatch: 'FULL_MATCH',
      feeling: 'NEED_MORE_TIME',
      decision: 'B_STOP',
      stopReasons: ['NO_SPARK'],
      stopNote: null,
    });
    expect(resB.status).toBe(201);

    const { rows: outboxAfter } = await database.pool.query(
      `select id from platform.outbox where event_type = 'FeedbackSubmitted'`,
    );
    expect(outboxAfter).toHaveLength(1);
  });

  it('AC3 (rò rỉ HTTP): a POST B_STOP với stopNote bí mật; b GET /feedback null, GET /current không lộ PII; b POST trả đánh giá của b; a GET thấy đúng ghi chú của mình', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);
    const datePlanId = await seedConfirmedDatePlan(matchId, a, b);
    matching.setMatch(matchId, a, b, 'DATING');

    clock.set(addDuration(STARTS, { hours: 3 }));

    const resA = await post(`/me/dates/${datePlanId}/feedback`, a, {
      rating: 1,
      profileMatch: 'DIFFERENT',
      feeling: 'NOT_A_FIT',
      decision: 'B_STOP',
      stopReasons: ['LIFESTYLE_DIFFERENCE'],
      stopNote: 'SECRET-NOTE-XYZ',
    });
    expect(resA.status).toBe(201);

    // Với user b: GET /me/dates/:id/feedback → { feedback: null }
    const getResB = await get(`/me/dates/${datePlanId}/feedback`, b);
    expect(getResB.status).toBe(200);
    const getBJson = await getResB.json();
    const parsedGetB = myFeedbackResponseSchema.parse(getBJson);
    expect(parsedGetB).toEqual({ feedback: null });
    expect(JSON.stringify(getBJson)).not.toContain('SECRET-NOTE-XYZ');

    // GET /me/dates/current → body không chứa chuỗi bí mật, không có các trường feedback
    const getCurrentB = await get('/me/dates/current', b);
    expect(getCurrentB.status).toBe(200);
    const currentBJson = (await getCurrentB.json()) as { datePlan: Record<string, unknown> | null };
    const currentBStr = JSON.stringify(currentBJson);
    expect(currentBStr).not.toContain('SECRET-NOTE-XYZ');
    const plan = currentBJson.datePlan;
    if (plan !== null) {
      const planKeys = Object.keys(plan);
      expect(planKeys).not.toContain('feedback');
      expect(planKeys).not.toContain('rating');
      expect(planKeys).not.toContain('stopNote');
      expect(planKeys).not.toContain('decision');
      expect(planKeys).not.toContain('profileMatch');
    }

    // b POST feedback của chính mình → response chỉ chứa đánh giá của b, không lộ bí mật và authorId/subjectId
    const resB = await post(`/me/dates/${datePlanId}/feedback`, b, {
      rating: 4,
      profileMatch: 'MOSTLY_MATCH',
      feeling: 'DEEP_INTEREST',
      decision: 'A_COMMIT',
      stopReasons: [],
      stopNote: null,
    });
    expect(resB.status).toBe(201);
    const postBJson = (await resB.json()) as Record<string, unknown>;
    const parsedPostB = myFeedbackSchema.parse(postBJson);
    expect(JSON.stringify(postBJson)).not.toContain('SECRET-NOTE-XYZ');
    expect(parsedPostB.rating).toBe(4);
    expect(parsedPostB.decision).toBe('A_COMMIT');
    const postBKeys = Object.keys(postBJson);
    expect(postBKeys).not.toContain('authorId');
    expect(postBKeys).not.toContain('subjectId');

    // Đồng thời a GET → thấy đúng ghi chú của mình
    const getResA = await get(`/me/dates/${datePlanId}/feedback`, a);
    expect(getResA.status).toBe(200);
    const getAJson = await getResA.json();
    const parsedGetA = myFeedbackResponseSchema.parse(getAJson);
    expect(parsedGetA.feedback?.stopNote).toBe('SECRET-NOTE-XYZ');
    expect(parsedGetA.feedback?.rating).toBe(1);
    expect(parsedGetA.feedback?.profileMatch).toBe('DIFFERENT');
  });

  it('Lỗi: gửi lại 409 FEEDBACK_ALREADY_SUBMITTED; người ngoài 403 NOT_PARTICIPANT; trước giờ hẹn 409 FEEDBACK_NOT_ALLOWED; body sai 400/422 VALIDATION_FAILED; A_COMMIT kèm stopReasons 422 FEEDBACK_INVALID', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);
    const datePlanId = await seedConfirmedDatePlan(matchId, a, b);

    clock.set(addDuration(STARTS, { hours: 3 }));

    const validBody = {
      rating: 5,
      profileMatch: 'FULL_MATCH',
      feeling: 'DEEP_INTEREST',
      decision: 'A_COMMIT',
      stopReasons: [],
      stopNote: null,
    };
    const resA = await post(`/me/dates/${datePlanId}/feedback`, a, validBody);
    expect(resA.status).toBe(201);

    // Gửi lại → 409 FEEDBACK_ALREADY_SUBMITTED
    const resDup = await post(`/me/dates/${datePlanId}/feedback`, a, validBody);
    expect(resDup.status).toBe(409);
    expect(await code(resDup)).toBe('FEEDBACK_ALREADY_SUBMITTED');

    // Người ngoài → 403 NOT_PARTICIPANT
    const strangerId = newId();
    const resStranger = await post(`/me/dates/${datePlanId}/feedback`, strangerId, validBody);
    expect(resStranger.status).toBe(403);
    expect(await code(resStranger)).toBe('NOT_PARTICIPANT');

    // Trước giờ hẹn (clock.set(T0)) → 409 FEEDBACK_NOT_ALLOWED
    const a2 = newId();
    const b2 = newId();
    const matchId2 = await seedDating(a2, b2);
    const datePlanId2 = await seedConfirmedDatePlan(matchId2, a2, b2);
    clock.set(T0);
    const resEarly = await post(`/me/dates/${datePlanId2}/feedback`, a2, validBody);
    expect(resEarly.status).toBe(409);
    expect(await code(resEarly)).toBe('FEEDBACK_NOT_ALLOWED');

    // Body sai (rating 7) → VALIDATION_FAILED theo parseBody
    clock.set(addDuration(STARTS, { hours: 3 }));
    const resBadBody = await post(`/me/dates/${datePlanId2}/feedback`, a2, {
      ...validBody,
      rating: 7,
    });
    expect([400, 422]).toContain(resBadBody.status);
    expect(await code(resBadBody)).toBe('VALIDATION_FAILED');

    // A_COMMIT kèm stopReasons → 422 FEEDBACK_INVALID
    const resInvalidStop = await post(`/me/dates/${datePlanId2}/feedback`, a2, {
      ...validBody,
      decision: 'A_COMMIT',
      stopReasons: ['NO_SPARK'],
    });
    expect(resInvalidStop.status).toBe(422);
    expect(await code(resInvalidStop)).toBe('FEEDBACK_INVALID');
  });

  it('Đồng thời: hai request POST A_COMMIT của a và b chạy song song (Promise.all) → cả hai 201, outbox đúng 1 FeedbackSubmitted SUCCESS', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);
    const datePlanId = await seedConfirmedDatePlan(matchId, a, b);

    clock.set(addDuration(STARTS, { hours: 3 }));

    const [resA, resB] = await Promise.all([
      post(`/me/dates/${datePlanId}/feedback`, a, {
        rating: 5,
        profileMatch: 'FULL_MATCH',
        feeling: 'DEEP_INTEREST',
        decision: 'A_COMMIT',
        stopReasons: [],
        stopNote: null,
      }),
      post(`/me/dates/${datePlanId}/feedback`, b, {
        rating: 5,
        profileMatch: 'FULL_MATCH',
        feeling: 'DEEP_INTEREST',
        decision: 'A_COMMIT',
        stopReasons: [],
        stopNote: null,
      }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const { rows: outboxEvents } = await database.pool.query<{ payload: { outcome: string } }>(
      `select payload from platform.outbox where event_type = 'FeedbackSubmitted'`,
    );
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]?.payload.outcome).toBe('SUCCESS');
  });

  it('sau POST feedback đầu tiên: dating.date_plans.status = COMPLETED và outbox có đúng 1 DateCompleted; feedback thứ hai không thêm', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);
    const datePlanId = await seedConfirmedDatePlan(matchId, a, b);

    clock.set(addDuration(STARTS, { hours: 3 }));

    const resA = await post(`/me/dates/${datePlanId}/feedback`, a, {
      rating: 5,
      profileMatch: 'FULL_MATCH',
      feeling: 'DEEP_INTEREST',
      decision: 'A_COMMIT',
      stopReasons: [],
      stopNote: null,
    });
    expect(resA.status).toBe(201);

    const { rows: planRows } = await database.pool.query<{ status: string }>(
      `select status from dating.date_plans where id = $1`,
      [datePlanId],
    );
    expect(planRows[0]?.status).toBe('COMPLETED');

    const { rows: completedRows } = await database.pool.query<OutboxFeedbackRow>(
      `select id, event_type, aggregate_type, aggregate_id, aggregate_version, occurred_at, payload
         from platform.outbox where event_type = 'DateCompleted' and aggregate_id = $1`,
      [datePlanId],
    );
    expect(completedRows).toHaveLength(1);
    expect(completedRows[0]?.payload).toMatchObject({
      datePlanId,
      matchId,
      inviterId: a,
      inviteeId: b,
      completedAt: clock.now().toISOString(),
    });

    const resB = await post(`/me/dates/${datePlanId}/feedback`, b, {
      rating: 4,
      profileMatch: 'MOSTLY_MATCH',
      feeling: 'DEEP_INTEREST',
      decision: 'A_COMMIT',
      stopReasons: [],
      stopNote: null,
    });
    expect(resB.status).toBe(201);

    const { rows: completedRowsAfter } = await database.pool.query(
      `select id from platform.outbox where event_type = 'DateCompleted' and aggregate_id = $1`,
      [datePlanId],
    );
    expect(completedRowsAfter).toHaveLength(1);
  });

  it('Admin: b gửi profileMatch DIFFERENT → reviewer GET /appearance-flags 200, item có authorId/subjectId không có stopNote; matchmaker 403; GET /feedbacks/:id reviewer 200 có stopNote + audit', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);
    const datePlanId = await seedConfirmedDatePlan(matchId, a, b);

    clock.set(addDuration(STARTS, { hours: 3 }));

    const resB = await post(`/me/dates/${datePlanId}/feedback`, b, {
      rating: 3,
      profileMatch: 'DIFFERENT',
      feeling: 'NOT_A_FIT',
      decision: 'B_STOP',
      stopReasons: ['LIFESTYLE_DIFFERENCE'],
      stopNote: 'Cần xác minh lại ảnh thẻ và mặt thật',
    });
    expect(resB.status).toBe(201);
    const feedbackId = ((await resB.json()) as { id: string }).id;

    // Token reviewer → 200, total 1, item có subjectId = a, authorId = b, không có stopNote
    const resFlags = await asAdmin('reviewer', 'GET', '/admin/dating/appearance-flags');
    expect(resFlags.status).toBe(200);
    const flagsData = appearanceFlagQueueResponseSchema.parse(await resFlags.json());
    expect(flagsData.total).toBe(1);
    expect(flagsData.items).toHaveLength(1);
    const flagItem = flagsData.items[0]!;
    expect(flagItem.feedbackId).toBe(feedbackId);
    expect(flagItem.matchId).toBe(matchId);
    expect(flagItem.datePlanId).toBe(datePlanId);
    expect(flagItem.authorId).toBe(b);
    expect(flagItem.subjectId).toBe(a);
    expect(Object.keys(flagItem)).not.toContain('stopNote');

    // Token matchmaker → 403
    const resForbidden = await asAdmin('matchmaker', 'GET', '/admin/dating/appearance-flags');
    expect(resForbidden.status).toBe(403);

    // GET /admin/dating/feedbacks/:feedbackId (reviewer) → 200 có stopNote + auditLogger.entries có 1 entry
    const resDetail = await asAdmin('reviewer', 'GET', `/admin/dating/feedbacks/${feedbackId}`);
    expect(resDetail.status).toBe(200);
    const detailData = adminFeedbackDetailSchema.parse(await resDetail.json());
    expect(detailData.id).toBe(feedbackId);
    expect(detailData.authorId).toBe(b);
    expect(detailData.subjectId).toBe(a);
    expect(detailData.stopNote).toBe('Cần xác minh lại ảnh thẻ và mặt thật');

    const audit = auditLogger.entries.find((e) => e.targetId === feedbackId);
    expect(audit).toBeDefined();
    expect(audit?.action).toBe('dating.feedback.view_detail');
    expect(audit?.actor).toEqual({ type: 'admin', id: REVIEWER });
    expect(audit?.ip).toBe('203.0.113.9');
    expect(audit?.meta).toEqual({ matchId, authorId: b, subjectId: a });
  });
});
