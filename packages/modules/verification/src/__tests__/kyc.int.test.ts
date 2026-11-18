import { createLogger } from '@tamgiao/config';
import { kycProgressResponseSchema, problemSchema } from '@tamgiao/contracts';
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
import { FakeClock, fail, newId, ok, type ObjectStorage } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl, withRollback } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CccdNumber } from '../domain/cccd-number.js';
import { KycSubmission } from '../domain/kyc-submission.js';
import { RejectionReason } from '../domain/rejection-reason.js';
import { DrizzleKycSubmissionRepository } from '../infrastructure/drizzle-kyc-submission-repository.js';
import { FAKE_EKYC_ID_CARD, FakeEkycProvider } from '../infrastructure/ekyc/fake-ekyc-provider.js';
import { createVerificationModule } from '../index.js';
import { FakeApplicantDirectory, FakeApplicantProfileReader, RecordingAuditLogger } from './fakes.js';

/** Mọi lời gọi eKYC trả CÙNG một số CCCD (mặc định của fake) → dùng để test trùng CCCD giữa 2 tài khoản. */
const CCCD = FAKE_EKYC_ID_CARD.cccdNumber;

let database: Database;
let app: Hono<AppEnv>;
let uow: DrizzleUnitOfWork;
let uploads: UploadService;
let repo: DrizzleKycSubmissionRepository;
const logLines: string[] = [];
const clock = new FakeClock(new Date('2026-11-18T01:00:00.000Z'));
const applicants = new FakeApplicantProfileReader();
const encryptor = new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
const blindIndexer = new HmacBlindIndexer(Buffer.alloc(32, 9));

/** Storage giả: mọi object "đã được tải lên" đúng như khai báo. */
const declared = new Map<string, { sizeBytes: number; contentType: string }>();
const storage: ObjectStorage = {
  presignPut: async (i) => {
    declared.set(i.key, { sizeBytes: i.sizeBytes, contentType: i.contentType });
    return { url: `https://storage.test/put/${i.key}`, method: 'PUT', headers: {}, expiresAt: clock.now() };
  },
  presignGet: async (i) => ({
    url: `https://storage.test/get/${i.key}`,
    method: 'GET',
    headers: {},
    expiresAt: clock.now(),
  }),
  head: async (_b, key) => declared.get(key) ?? null,
  delete: async () => undefined,
};

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  uploads = new UploadService({ uow, clock, storage, putTtlSeconds: 300 });
  repo = new DrizzleKycSubmissionRepository(encryptor, blindIndexer, new OutboxWriter());
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const module = createVerificationModule({
    uow,
    clock,
    encryptor,
    blindIndexer,
    uploads,
    ekyc: new FakeEkycProvider(),
    applicants,
    requireUser,
    applicantDirectory: new FakeApplicantDirectory(),
    storage,
    requireAdmin: createRequireAdmin(async () => fail('UNAUTHENTICATED')),
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
});
afterAll(() => database.close());

async function uploadKey(ownerId: string, purpose: 'kyc_doc' | 'kyc_selfie'): Promise<string> {
  const r = await uploads.requestUpload({ ownerId, purpose, contentType: 'image/jpeg', sizeBytes: 100 });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value.key;
}

async function docsFor(userId: string) {
  return {
    cccdFrontKey: await uploadKey(userId, 'kyc_doc'),
    cccdBackKey: await uploadKey(userId, 'kyc_doc'),
    selfieKey: await uploadKey(userId, 'kyc_selfie'),
    maritalStatusCertificateKey: await uploadKey(userId, 'kyc_doc'),
  };
}

const post = (userId: string, body: unknown) =>
  app.request('/me/kyc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': userId },
    body: JSON.stringify(body),
  });
const get = (userId: string) => app.request('/me/kyc', { headers: { 'x-test-user': userId } });
const code = async (res: Response) => problemSchema.parse(await res.json()).code;

describe('POST /me/kyc, GET /me/kyc', () => {
  it('submits and returns 4 steps; GET returns the same progress (AC3)', async () => {
    const user = newId<'User'>();
    const res = await post(user, await docsFor(user));
    expect(res.status).toBe(201);
    const body = kycProgressResponseSchema.parse(await res.json());
    expect(body).toEqual({
      status: 'SUBMITTED',
      submittedAt: '2026-11-18T01:00:00.000Z',
      decidedAt: null,
      steps: [
        { step: 'CCCD_CHIP', status: 'PENDING', decidedAt: null },
        { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
        { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
        { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
      ],
      moreInfo: null,
      rejectionReason: null,
    });

    const again = await get(user);
    expect(again.status).toBe(200);
    expect(kycProgressResponseSchema.parse(await again.json())).toEqual(body);
  });

  it('GET before submitting → 200 NOT_SUBMITTED with 4 pending steps', async () => {
    const res = await get(newId<'User'>());
    expect(res.status).toBe(200);
    const body = kycProgressResponseSchema.parse(await res.json());
    expect(body.status).toBe('NOT_SUBMITTED');
    expect(body.steps.map((s) => s.step)).toEqual([
      'CCCD_CHIP',
      'MARITAL_STATUS',
      'MANUAL_REVIEW',
      'INTERVIEW',
    ]);
  });

  it('CCCD number is never stored, emitted or logged in clear text (AC2)', async () => {
    const user = newId<'User'>();
    expect((await post(user, await docsFor(user))).status).toBe(201);
    expect((await get(user)).status).toBe(200);

    const { rows } = await database.pool.query(
      'select cccd_number_enc, cccd_number_bidx, row_to_json(k)::text as raw from verification.kyc_submissions k where user_id = $1',
      [user],
    );
    const row = rows[0] as { cccd_number_enc: Buffer; cccd_number_bidx: string; raw: string };
    expect(Buffer.isBuffer(row.cccd_number_enc)).toBe(true);
    expect(row.cccd_number_enc.toString('utf8')).not.toContain(CCCD);
    expect(row.cccd_number_enc.toString('hex')).not.toContain(Buffer.from(CCCD).toString('hex'));
    expect(row.cccd_number_bidx).toBe(blindIndexer.index(CCCD, 'verification.cccd_number'));
    expect(row.raw).not.toContain(CCCD);

    const outbox = await database.pool.query('select payload::text as payload from platform.outbox');
    expect(outbox.rows).toHaveLength(1);
    expect((outbox.rows[0] as { payload: string }).payload).not.toContain(CCCD);

    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join('\n')).not.toContain(CCCD);

    // Giải mã lại đúng số (context gắn với userId).
    const loaded = await withRollback(uow, (tx) => repo.findByUserId(tx, user));
    expect(loaded?.toState().cccdNumber?.value).toBe(CCCD);
  });

  it('writes KycSubmitted to the outbox in the same transaction', async () => {
    const user = newId<'User'>();
    expect((await post(user, await docsFor(user))).status).toBe(201);
    const { rows } = await database.pool.query(
      `select event_type, aggregate_type, payload from platform.outbox where event_type = 'KycSubmitted'`,
    );
    expect(rows).toEqual([
      {
        event_type: 'KycSubmitted',
        aggregate_type: 'KycSubmission',
        payload: { submissionId: expect.any(String), userId: user, resubmission: false },
      },
    ]);
  });

  it('missing documents → 422 KYC_DOCS_MISSING; unauthenticated → 401', async () => {
    const user = newId<'User'>();
    const { cccdFrontKey, selfieKey } = await docsFor(user);
    const res = await post(user, { cccdFrontKey, selfieKey });
    expect(res.status).toBe(422);
    const problem = problemSchema.parse(await res.json());
    expect(problem.code).toBe('KYC_DOCS_MISSING');
    expect(problem.meta).toEqual({ missing: ['cccdBackKey', 'maritalStatusCertificateKey'] });

    const anon = await app.request('/me/kyc', { method: 'POST', body: '{}' });
    expect(anon.status).toBe(401);
  });

  it("another user's upload key → 403 UPLOAD_NOT_OWNED, nothing stored", async () => {
    const user = newId<'User'>();
    const other = newId<'User'>();
    const docs = await docsFor(user);
    const otherDocs = await docsFor(other);
    const res = await post(user, { ...docs, selfieKey: otherDocs.selfieKey });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('UPLOAD_NOT_OWNED');
    const { rows } = await database.pool.query('select 1 from verification.kyc_submissions');
    expect(rows).toHaveLength(0);
  });

  it('submitting again while under review → 409 KYC_ALREADY_SUBMITTED', async () => {
    const user = newId<'User'>();
    expect((await post(user, await docsFor(user))).status).toBe(201);
    const res = await post(user, await docsFor(user));
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('KYC_ALREADY_SUBMITTED');
  });
});

describe('one CCCD per account (AC1, A10)', () => {
  it('CCCD already bound to another account → 409 CCCD_ALREADY_REGISTERED', async () => {
    const a = newId<'User'>();
    const b = newId<'User'>();
    expect((await post(a, await docsFor(a))).status).toBe(201);
    const res = await post(b, await docsFor(b));
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('CCCD_ALREADY_REGISTERED');
    expect((await get(b)).status).toBe(200);
    expect(kycProgressResponseSchema.parse(await (await get(b)).json()).status).toBe('NOT_SUBMITTED');
  });

  it('two different users submitting the same CCCD concurrently → exactly one succeeds', async () => {
    const users = [newId<'User'>(), newId<'User'>()];
    const docs = await Promise.all(users.map((u) => docsFor(u)));
    const results = await runConcurrently(2, async (i) => {
      const res = await post(users[i] as string, docs[i]);
      return { status: res.status, code: res.status === 201 ? null : await code(res) };
    });
    const settled = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { status: 500, code: 'REJECTED' },
    );
    expect(settled.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(settled.find((r) => r.status === 409)?.code).toBe('CCCD_ALREADY_REGISTERED');

    const { rows } = await database.pool.query('select user_id from verification.kyc_submissions');
    expect(rows).toHaveLength(1);
    const outbox = await database.pool.query(
      `select 1 from platform.outbox where event_type = 'KycSubmitted'`,
    );
    expect(outbox.rows).toHaveLength(1);
  });

  it('five users racing with the same CCCD → exactly one row', async () => {
    const users = Array.from({ length: 5 }, () => newId<'User'>());
    const docs = await Promise.all(users.map((u) => docsFor(u)));
    const results = await runConcurrently(5, async (i) => (await post(users[i] as string, docs[i])).status);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value : 500));
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    const { rows } = await database.pool.query('select 1 from verification.kyc_submissions');
    expect(rows).toHaveLength(1);
  });

  it('the same user submitting twice concurrently → one 201, one KYC_ALREADY_SUBMITTED', async () => {
    const user = newId<'User'>();
    const [d1, d2] = [await docsFor(user), await docsFor(user)];
    const results = await runConcurrently(2, async (i) => {
      const res = await post(user, i === 0 ? d1 : d2);
      return { status: res.status, code: res.status === 201 ? null : await code(res) };
    });
    const settled = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { status: 500, code: 'REJECTED' },
    );
    expect(settled.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(settled.find((r) => r.status === 409)?.code).toBe('KYC_ALREADY_SUBMITTED');
  });

  it('the database unique index itself rejects a duplicate blind index', async () => {
    const insert = (userId: string) => {
      const s = KycSubmission.start({ id: newId<'KycSubmission'>(), userId }, clock.now());
      s.recordCccdNumber(CccdNumber.parse(CCCD).unwrapOr(null as never), clock.now());
      s.submit(clock.now());
      return uow.run((tx) => repo.save(tx, s));
    };
    expect((await insert(newId<'User'>())).isOk()).toBe(true);
    const dup = await insert(newId<'User'>());
    expect(!dup.ok && dup.error.code).toBe('CCCD_ALREADY_REGISTERED');
  });
});

describe('DrizzleKycSubmissionRepository', () => {
  it('round-trips every field (documents, eKYC assessment, steps, more-info, rejection)', async () => {
    const user = newId<'User'>();
    const t = clock.now();
    const s = KycSubmission.start({ id: newId<'KycSubmission'>(), userId: user }, t);
    s.attachDocuments(
      { cccdFrontKey: 'f', cccdBackKey: 'b', selfieKey: 's', maritalStatusCertificateKey: 'm' },
      t,
    );
    s.recordEkycAssessment(
      {
        ocr: { status: 'OK', score: null },
        liveness: { status: 'REJECTED', reason: 'LIVENESS_FAILED', score: 0.2 },
        faceMatch: { status: 'ERROR', reason: 'TIMEOUT' },
        profileMismatches: ['BIRTH_DATE'],
        assessedAt: t,
      },
      t,
    );
    s.recordCccdNumber(CccdNumber.parse('079201000123').unwrapOr(null as never), t);
    s.submit(t);
    s.assignReviewer(newId<'Admin'>(), t);
    s.markStep('CCCD_CHIP', 'PASSED', t);
    s.requestMoreInfo({ items: ['SELFIE', 'OTHER'], note: 'Chụp lại selfie' }, t);
    expect((await uow.run((tx) => repo.save(tx, s))).isOk()).toBe(true);

    const loaded = await withRollback(uow, (tx) => repo.findByUserIdForUpdate(tx, user));
    expect(loaded?.toState()).toEqual(s.toState());

    const reviewer = newId<'Admin'>();
    const rejected = KycSubmission.restore(s.toState());
    rejected.reject(
      RejectionReason.create({ code: 'OTHER', note: 'Giấy tờ không hợp lệ' }).unwrapOr(null as never),
      reviewer,
      t,
    );
    expect((await uow.run((tx) => repo.save(tx, rejected))).isOk()).toBe(true);
    const reloaded = await uow.run(async (tx) => ok(await repo.findByUserId(tx, user)));
    expect(reloaded.unwrapOr(null)?.toState()).toEqual(rejected.toState());
  });
});
