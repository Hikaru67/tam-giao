import { createLogger } from '@tamgiao/config';
import {
  adminInterviewSlotListResponseSchema,
  adminInterviewSlotSchema,
  availableInterviewSlotListResponseSchema,
  kycProgressResponseSchema,
  myInterviewResponseSchema,
  problemSchema,
} from '@tamgiao/contracts';
import {
  DrizzleUnitOfWork,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  OutboxWriter,
  UploadService,
  createDatabase,
  type Database,
} from '@tamgiao/db';
import { createRequireAdmin, handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { FakeClock, addDuration, fail, newId, ok, type ObjectStorage } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl, withRollback } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InterviewSlot, type InterviewSlotId } from '../domain/interview-slot.js';
import { KycSubmission } from '../domain/kyc-submission.js';
import { DrizzleInterviewSlotRepository } from '../infrastructure/drizzle-interview-slot-repository.js';
import { DrizzleKycSubmissionRepository } from '../infrastructure/drizzle-kyc-submission-repository.js';
import { FakeEkycProvider } from '../infrastructure/ekyc/fake-ekyc-provider.js';
import { createVerificationModule } from '../index.js';
import {
  FakeApplicantDirectory,
  FakeApplicantProfileReader,
  FakePaymentStatusReader,
  RecordingAuditLogger,
} from './fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const NOTES = 'Ứng viên chia sẻ đã ly hôn năm 2020, SĐT 0901234567';

let database: Database;
let app: Hono<AppEnv>;
let uow: DrizzleUnitOfWork;
let kycRepo: DrizzleKycSubmissionRepository;
const slotRepo = new DrizzleInterviewSlotRepository();
const logLines: string[] = [];
const clock = new FakeClock(T0);
const encryptor = new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
const blindIndexer = new HmacBlindIndexer(Buffer.alloc(32, 9));
const storage: ObjectStorage = {
  presignPut: async () => ({
    url: 'https://storage.test',
    method: 'PUT',
    headers: {},
    expiresAt: clock.now(),
  }),
  presignGet: async () => ({
    url: 'https://storage.test',
    method: 'GET',
    headers: {},
    expiresAt: clock.now(),
  }),
  head: async () => null,
  delete: async () => undefined,
};

/** Token admin giả: `reviewer.<adminId>` có `kyc:review`; `matchmaker.<adminId>` không có. */
const REVIEWER = newId<'Admin'>();
const reviewerToken = `reviewer.${REVIEWER}`;
const matchmakerToken = `matchmaker.${newId<'Admin'>()}`;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  kycRepo = new DrizzleKycSubmissionRepository(encryptor, blindIndexer, new OutboxWriter());
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const requireAdmin = createRequireAdmin(async (token) => {
    const [role, adminId] = token.split('.');
    if (adminId === undefined) return fail('UNAUTHENTICATED');
    const permissions = role === 'reviewer' ? ['kyc:review', 'kyc:decide'] : ['match:propose'];
    return ok({ adminId, sessionId: newId(), role: role ?? '', permissions });
  });
  const module = createVerificationModule({
    uow,
    clock,
    encryptor,
    blindIndexer,
    uploads: new UploadService({ uow, clock, storage, putTtlSeconds: 300 }),
    ekyc: new FakeEkycProvider(),
    applicants: new FakeApplicantProfileReader(),
    payments: new FakePaymentStatusReader(),
    applicantDirectory: new FakeApplicantDirectory(),
    storage,
    requireUser,
    requireAdmin,
    auditLogger: new RecordingAuditLogger(),
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
  logLines.length = 0;
  clock.set(T0);
});
afterAll(() => database.close());

/** Người dùng có hồ sơ eKYC đã nộp (ghi thẳng qua repository). */
async function userWithSubmission(): Promise<string> {
  const userId = newId<'User'>();
  const s = KycSubmission.start({ id: newId<'KycSubmission'>(), userId }, T0);
  s.attachDocuments(
    { cccdFrontKey: 'f', cccdBackKey: 'b', selfieKey: 's', maritalStatusCertificateKey: 'm' },
    T0,
  );
  s.submit(T0);
  const saved = await uow.run((tx) => kycRepo.save(tx, s));
  if (saved.isErr()) throw new Error(saved.error.code);
  return userId;
}

const json = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const asUser = (userId: string) => ({ 'x-test-user': userId });
const asAdmin = (token = reviewerToken) => ({ authorization: `Bearer ${token}` });
const code = async (res: Response) => problemSchema.parse(await res.json()).code;

async function openSlot(
  hoursFromNow: number,
  meetingUrl: string | null = 'https://meet.test/room',
): Promise<string> {
  const res = await json('POST', '/admin/kyc/interview/slots', asAdmin(), {
    startsAt: addDuration(clock.now(), { hours: hoursFromNow }).toISOString(),
    meetingUrl,
  });
  expect(res.status).toBe(201);
  return adminInterviewSlotSchema.parse(await res.json()).id;
}

const book = (userId: string, slotId: string) =>
  json('POST', '/me/kyc/interview', asUser(userId), { slotId });

describe('AC1 — concurrent booking of the same slot', () => {
  it('two users booking the same slot concurrently → exactly one succeeds, the other SLOT_TAKEN', async () => {
    const users = [await userWithSubmission(), await userWithSubmission()];
    const slotId = await openSlot(24);
    const results = await runConcurrently(2, async (i) => {
      const res = await book(users[i] as string, slotId);
      return { status: res.status, code: res.status === 201 ? null : await code(res) };
    });
    const settled = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { status: 500, code: 'REJECTED' },
    );
    expect(settled.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(settled.find((r) => r.status === 409)?.code).toBe('SLOT_TAKEN');

    const winner = users[settled.findIndex((r) => r.status === 201)];
    const { rows } = await database.pool.query('select booked_by, status from verification.interview_slots');
    expect(rows).toEqual([{ booked_by: winner, status: 'BOOKED' }]);
  });

  it('five users racing for one slot → exactly one booking', async () => {
    const users = await Promise.all(Array.from({ length: 5 }, () => userWithSubmission()));
    const slotId = await openSlot(24);
    const results = await runConcurrently(5, async (i) => (await book(users[i] as string, slotId)).status);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value : 500));
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
  });

  it('the same user booking two slots concurrently → one booking, other INTERVIEW_ALREADY_BOOKED', async () => {
    const user = await userWithSubmission();
    const slotIds = [await openSlot(24), await openSlot(48)];
    const results = await runConcurrently(2, async (i) => {
      const res = await book(user, slotIds[i] as string);
      return { status: res.status, code: res.status === 201 ? null : await code(res) };
    });
    const settled = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { status: 500, code: 'REJECTED' },
    );
    expect(settled.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(settled.find((r) => r.status === 409)?.code).toBe('INTERVIEW_ALREADY_BOOKED');
    const { rows } = await database.pool.query(
      `select 1 from verification.interview_slots where booked_by = $1 and status = 'BOOKED'`,
      [user],
    );
    expect(rows).toHaveLength(1);
  });

  it('the partial unique index itself rejects a second BOOKED slot for one user', async () => {
    const user = newId<'User'>();
    const bookedSlot = (hours: number) => {
      const s = InterviewSlot.open(
        { id: newId<'InterviewSlot'>(), interviewerId: REVIEWER, startsAt: addDuration(T0, { hours }) },
        T0,
      ).unwrapOr(null as never);
      s.book(user, T0);
      return uow.run((tx) => slotRepo.save(tx, s));
    };
    expect((await bookedSlot(24)).isOk()).toBe(true);
    const dup = await bookedSlot(48);
    expect(!dup.ok && dup.error.code).toBe('INTERVIEW_ALREADY_BOOKED');
  });

  it('an interviewer opening the same slot twice concurrently → one 201, one INTERVIEW_SLOT_OVERLAP', async () => {
    const startsAt = addDuration(T0, { hours: 24 }).toISOString();
    const results = await runConcurrently(2, async () => {
      const res = await json('POST', '/admin/kyc/interview/slots', asAdmin(), { startsAt });
      return { status: res.status, code: res.status === 201 ? null : await code(res) };
    });
    const settled = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { status: 500, code: 'REJECTED' },
    );
    expect(settled.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(settled.find((r) => r.status === 409)?.code).toBe('INTERVIEW_SLOT_OVERLAP');
  });
});

describe('user booking flow', () => {
  it('lists open slots without interviewer/meeting url; GET /me/kyc/interview shows the booking', async () => {
    const user = await userWithSubmission();
    const a = await openSlot(24);
    const b = await openSlot(48);

    const list = await json('GET', '/me/kyc/interview/slots', asUser(user));
    expect(list.status).toBe(200);
    const raw = (await list.json()) as { items: Record<string, unknown>[] };
    expect(Object.keys(raw.items[0] ?? {}).sort()).toEqual(['endsAt', 'id', 'startsAt']);
    expect(availableInterviewSlotListResponseSchema.parse(raw).items.map((s) => s.id)).toEqual([a, b]);

    const res = await book(user, a);
    expect(res.status).toBe(201);
    expect(myInterviewResponseSchema.parse(await res.json())).toEqual({
      booking: {
        slotId: a,
        startsAt: '2026-11-19T01:00:00.000Z',
        endsAt: '2026-11-19T01:15:00.000Z',
        meetingUrl: 'https://meet.test/room',
        changeDeadline: '2026-11-18T23:00:00.000Z',
        canChange: true,
      },
    });
    const mine = myInterviewResponseSchema.parse(
      await (await json('GET', '/me/kyc/interview', asUser(user))).json(),
    );
    expect(mine.booking?.slotId).toBe(a);

    const after = availableInterviewSlotListResponseSchema.parse(
      await (await json('GET', '/me/kyc/interview/slots', asUser(user))).json(),
    );
    expect(after.items.map((s) => s.id)).toEqual([b]);
  });

  it('reschedule (PUT) moves the booking; cancel (DELETE) frees it; both refused within 2h', async () => {
    const user = await userWithSubmission();
    const a = await openSlot(24);
    const b = await openSlot(48);
    await book(user, a);

    const moved = await json('PUT', '/me/kyc/interview', asUser(user), { slotId: b });
    expect(moved.status).toBe(200);
    expect(myInterviewResponseSchema.parse(await moved.json()).booking?.slotId).toBe(b);
    const { rows } = await database.pool.query(
      'select id, status, booked_by from verification.interview_slots order by starts_at',
    );
    expect(rows).toEqual([
      { id: a, status: 'OPEN', booked_by: null },
      { id: b, status: 'BOOKED', booked_by: user },
    ]);

    clock.advance({ hours: 46, minutes: 1 }); // còn 1h59m trước slot b
    const late = await json('DELETE', '/me/kyc/interview', asUser(user));
    expect(late.status).toBe(409);
    const problem = problemSchema.parse(await late.json());
    expect(problem.code).toBe('CANCEL_TOO_LATE');
    expect(problem.meta).toEqual({ deadline: '2026-11-19T23:00:00.000Z' });
    expect((await json('PUT', '/me/kyc/interview', asUser(user), { slotId: a })).status).toBe(409);

    clock.set(T0);
    const cancelled = await json('DELETE', '/me/kyc/interview', asUser(user));
    expect(cancelled.status).toBe(200);
    expect(myInterviewResponseSchema.parse(await cancelled.json())).toEqual({ booking: null });
  });

  it('booking without a KYC submission → 409 INTERVIEW_REQUIRES_SUBMISSION; bad body → 422; anon → 401', async () => {
    const slotId = await openSlot(24);
    const res = await book(newId<'User'>(), slotId);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('INTERVIEW_REQUIRES_SUBMISSION');
    expect((await json('POST', '/me/kyc/interview', asUser(newId()), { slotId: 'x' })).status).toBe(422);
    expect((await json('POST', '/me/kyc/interview', {}, { slotId })).status).toBe(401);
  });
});

describe('admin: journal + notes (AC2)', () => {
  it('recording notes marks the INTERVIEW step; notes never reach logs or the outbox', async () => {
    const user = await userWithSubmission();
    const slotId = await openSlot(24);
    await book(user, slotId);
    clock.advance({ hours: 24, minutes: 15 });

    const res = await json('PUT', `/admin/kyc/interview/${slotId}/notes`, asAdmin(), {
      outcome: 'PASSED',
      notes: NOTES,
    });
    expect(res.status).toBe(200);
    expect(adminInterviewSlotSchema.parse(await res.json())).toMatchObject({
      id: slotId,
      status: 'COMPLETED',
      outcome: 'PASSED',
      notes: NOTES,
      bookedBy: user,
      recordedBy: REVIEWER,
      recordedAt: '2026-11-19T01:15:00.000Z',
    });

    const progress = kycProgressResponseSchema.parse(
      await (await json('GET', '/me/kyc', asUser(user))).json(),
    );
    expect(progress.steps.find((s) => s.step === 'INTERVIEW')).toEqual({
      step: 'INTERVIEW',
      status: 'PASSED',
      decidedAt: '2026-11-19T01:15:00.000Z',
    });

    const journal = adminInterviewSlotListResponseSchema.parse(
      await (await json('GET', '/admin/kyc/interview/slots?status=COMPLETED', asAdmin())).json(),
    );
    expect(journal.items.map((s) => [s.id, s.notes])).toEqual([[slotId, NOTES]]);

    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join('\n')).not.toContain('0901234567');
    const outbox = await database.pool.query('select payload::text as payload from platform.outbox');
    expect(outbox.rows.map((r: { payload: string }) => r.payload).join()).not.toContain('0901234567');
  });

  it('recording before the slot starts → 409 INTERVIEW_NOT_STARTED, step unchanged', async () => {
    const user = await userWithSubmission();
    const slotId = await openSlot(24);
    await book(user, slotId);
    const res = await json('PUT', `/admin/kyc/interview/${slotId}/notes`, asAdmin(), {
      outcome: 'FAILED',
      notes: 'x',
    });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('INTERVIEW_NOT_STARTED');
    const loaded = await withRollback(uow, (tx) => kycRepo.findByUserId(tx, user));
    expect(loaded?.steps.INTERVIEW.status).toBe('PENDING');
  });

  it('unknown slot → 404; empty notes → 422', async () => {
    const res = await json('PUT', `/admin/kyc/interview/${newId()}/notes`, asAdmin(), {
      outcome: 'PASSED',
      notes: 'x',
    });
    expect(res.status).toBe(404);
    expect(await code(res)).toBe('INTERVIEW_SLOT_NOT_FOUND');
    const empty = await json('PUT', `/admin/kyc/interview/${newId()}/notes`, asAdmin(), {
      outcome: 'PASSED',
      notes: '  ',
    });
    expect(empty.status).toBe(422);
  });

  it('admin routes require kyc:review (401 without token, 403 without permission)', async () => {
    const body = { startsAt: addDuration(T0, { hours: 24 }).toISOString() };
    expect((await json('POST', '/admin/kyc/interview/slots', {}, body)).status).toBe(401);
    const forbidden = await json('POST', '/admin/kyc/interview/slots', asAdmin(matchmakerToken), body);
    expect(forbidden.status).toBe(403);
    expect(await code(forbidden)).toBe('FORBIDDEN');
    expect((await json('GET', '/admin/kyc/interview/slots', asAdmin(matchmakerToken))).status).toBe(403);
    expect(
      (
        await json('PUT', `/admin/kyc/interview/${newId()}/notes`, asAdmin(matchmakerToken), {
          outcome: 'PASSED',
          notes: 'x',
        })
      ).status,
    ).toBe(403);
  });

  it('opening a slot in the past → 422; invalid meeting url → 422', async () => {
    const past = await json('POST', '/admin/kyc/interview/slots', asAdmin(), { startsAt: T0.toISOString() });
    expect(past.status).toBe(422);
    expect(await code(past)).toBe('INTERVIEW_SLOT_IN_PAST');
    const badUrl = await json('POST', '/admin/kyc/interview/slots', asAdmin(), {
      startsAt: addDuration(T0, { hours: 1 }).toISOString(),
      meetingUrl: 'javascript:alert(1)',
    });
    expect(badUrl.status).toBe(422);
  });
});

describe('DrizzleInterviewSlotRepository', () => {
  it('round-trips every field and filters the journal by status/time', async () => {
    const user = newId<'User'>();
    const s = InterviewSlot.open(
      {
        id: newId<'InterviewSlot'>(),
        interviewerId: REVIEWER,
        startsAt: addDuration(T0, { hours: 3 }),
        meetingUrl: 'https://meet.test/a',
      },
      T0,
    ).unwrapOr(null as never);
    s.book(user, T0);
    s.recordResult({ outcome: 'FAILED', notes: 'n', recordedBy: REVIEWER }, addDuration(T0, { hours: 4 }));
    expect((await uow.run((tx) => slotRepo.save(tx, s))).isOk()).toBe(true);

    const loaded = await withRollback(uow, (tx) => slotRepo.findById(tx, s.id as InterviewSlotId));
    expect(loaded?.toState()).toEqual(s.toState());

    const completed = await withRollback(uow, (tx) =>
      slotRepo.list(tx, { status: 'COMPLETED', from: T0, to: addDuration(T0, { hours: 4 }), limit: 10 }),
    );
    expect(completed.map((x) => x.id)).toEqual([s.id]);
    const none = await withRollback(uow, (tx) =>
      slotRepo.list(tx, { from: addDuration(T0, { hours: 4 }), limit: 10 }),
    );
    expect(none).toEqual([]);
  });
});
