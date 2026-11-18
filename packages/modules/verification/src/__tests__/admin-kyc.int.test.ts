import { createLogger } from '@tamgiao/config';
import {
  adminLoginResponseSchema,
  adminMeResponseSchema,
  kycAdminDecisionResponseSchema,
  kycAdminDetailResponseSchema,
  kycQueueResponseSchema,
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
import { handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { FakeClock, newId, type ObjectStorage, type Tx } from '@tamgiao/kernel';
import { ConsoleSmsSender, createIdentityModule, type IdentityModule } from '@tamgiao/module-identity';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApproveKyc } from '../application/admin/approve-kyc.js';
import { CccdNumber } from '../domain/cccd-number.js';
import { ekycFlags } from '../domain/ekyc-flags.js';
import {
  KYC_STEPS,
  KycSubmission,
  type EkycAssessment,
  type KycSubmissionId,
} from '../domain/kyc-submission.js';
import { DrizzleKycSubmissionRepository } from '../infrastructure/drizzle-kyc-submission-repository.js';
import { FakeEkycProvider } from '../infrastructure/ekyc/fake-ekyc-provider.js';
import { createVerificationModule } from '../index.js';
import { FakeApplicantDirectory, FakeApplicantProfileReader, RecordingAuditLogger } from './fakes.js';

const PASSWORD = 'correct horse battery staple';
const IP = '203.0.113.7';

let database: Database;
let app: Hono<AppEnv>;
let uow: DrizzleUnitOfWork;
let repo: DrizzleKycSubmissionRepository;
let identity: IdentityModule;
const clock = new FakeClock(new Date('2026-11-18T01:00:00.000Z'));
const directory = new FakeApplicantDirectory();
const encryptor = new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
const blindIndexer = new HmacBlindIndexer(Buffer.alloc(32, 9));

const storage: ObjectStorage = {
  presignPut: async () => {
    throw new Error('not used');
  },
  presignGet: async (i) => ({
    url: `https://storage.test/${i.bucket}/${i.key}?sig=1`,
    method: 'GET',
    headers: {},
    expiresAt: new Date(clock.now().getTime() + 300_000),
  }),
  head: async () => null,
  delete: async () => undefined,
};

/** Token đăng nhập + id của từng chuyên viên (seed một lần cho cả file). */
const admins: Record<'reviewer' | 'reviewer2' | 'matchmaker', { token: string; id: string }> = {
  reviewer: { token: '', id: '' },
  reviewer2: { token: '', id: '' },
  matchmaker: { token: '', id: '' },
};

/** TOTP RFC 6238 (SHA-1, 30 giây, 6 số) — tự tính để không import infrastructure của identity. */
async function totpCode(secretBase32: string, at: Date): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 1000 / 30)));
  const hmac = createHmac('sha1', bytes).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

async function seedAdmin(email: string, role: string): Promise<{ token: string; id: string }> {
  const created = await identity.commands.createAdminUser.execute({ email, password: PASSWORD, role });
  if (created.isErr()) throw new Error(created.error.code);
  const secret = new URL(created.value.otpauthUri).searchParams.get('secret');
  if (!secret) throw new Error('otpauth URI thiếu secret');
  const res = await app.request('/admin/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
    body: JSON.stringify({ email, password: PASSWORD, totpCode: await totpCode(secret, clock.now()) }),
  });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status}`);
  const token = adminLoginResponseSchema.parse(await res.json()).token;
  const me = await app.request('/admin/auth/me', { headers: { authorization: `Bearer ${token}` } });
  return { token, id: adminMeResponseSchema.parse(await me.json()).adminId };
}

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  await resetDatabase(database.pool);
  uow = new DrizzleUnitOfWork(database.pool);
  repo = new DrizzleKycSubmissionRepository(encryptor, blindIndexer, new OutboxWriter());
  identity = createIdentityModule({
    uow,
    clock,
    encryptor,
    blindIndexer,
    smsSender: new ConsoleSmsSender(),
    authSecret: Buffer.alloc(32, 11),
  });
  const verification = createVerificationModule({
    uow,
    clock,
    encryptor,
    blindIndexer,
    uploads: new UploadService({ uow, clock, storage, putTtlSeconds: 300 }),
    ekyc: new FakeEkycProvider(),
    applicants: new FakeApplicantProfileReader(),
    requireUser: createMiddleware<AppEnv>(async (c) => c.json({ code: 'UNAUTHENTICATED' }, 401)),
    applicantDirectory: directory,
    storage,
    requireAdmin: identity.requireAdmin,
    auditLogger: identity.auditLogger,
  });
  const logger = createLogger({ service: 'api', level: 'silent' });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(logger, { trustProxy: true }));
  app.route('/', identity.routes);
  app.route('/', verification.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);

  admins.reviewer = await seedAdmin('rv1@tamgiao.vn', 'REVIEWER');
  admins.reviewer2 = await seedAdmin('rv2@tamgiao.vn', 'SUPERVISOR');
  admins.matchmaker = await seedAdmin('mm@tamgiao.vn', 'MATCHMAKER');
});
beforeEach(async () => {
  await database.pool.query(
    'truncate table verification.kyc_submissions, identity.audit_logs, platform.outbox restart identity cascade',
  );
  directory.summaries.clear();
});
afterAll(() => database.close());

const CLEAN: EkycAssessment = {
  ocr: { status: 'OK', score: null },
  liveness: { status: 'OK', score: 0.97 },
  faceMatch: { status: 'OK', score: 0.91 },
  profileMismatches: [],
  assessedAt: new Date('2026-11-18T00:59:00.000Z'),
};

let cccdSeq = 0;
interface SeedOptions {
  readonly withCccd?: boolean;
  readonly assessment?: EkycAssessment | null;
  readonly submittedAt?: Date;
  /** Gán chuyên viên + đánh dấu cả 4 bước đạt → sẵn sàng duyệt. */
  readonly ready?: boolean;
}

async function seed(
  options: SeedOptions = {},
): Promise<{ id: KycSubmissionId; userId: string; cccd: string }> {
  const userId = newId<'User'>();
  const at = options.submittedAt ?? clock.now();
  const cccd = `0790${String(++cccdSeq).padStart(8, '0')}`;
  const s = KycSubmission.start({ id: newId<'KycSubmission'>(), userId }, at);
  s.attachDocuments(
    {
      cccdFrontKey: `kyc_doc/${userId}/front.jpg`,
      cccdBackKey: `kyc_doc/${userId}/back.jpg`,
      selfieKey: `kyc_selfie/${userId}/selfie.jpg`,
      maritalStatusCertificateKey: `kyc_doc/${userId}/marital.jpg`,
    },
    at,
  );
  if (options.withCccd ?? true) {
    const parsed = CccdNumber.parse(cccd);
    if (parsed.isErr()) throw new Error('bad cccd');
    s.recordCccdNumber(parsed.value, at);
  }
  if (options.assessment !== null) s.recordEkycAssessment(options.assessment ?? CLEAN, at);
  s.submit(at);
  if (options.ready) {
    s.assignReviewer(admins.reviewer.id, at);
    for (const step of KYC_STEPS) s.markStep(step, 'PASSED', at);
  }
  const saved = await uow.run((tx: Tx) => repo.save(tx, s));
  if (saved.isErr()) throw new Error(saved.error.code);
  await database.pool.query('truncate table platform.outbox');
  return { id: s.id, userId, cccd };
}

const call = async (
  method: string,
  path: string,
  who: keyof typeof admins | null,
  body?: unknown,
): Promise<Response> =>
  app.request(path, {
    method,
    headers: {
      'x-forwarded-for': IP,
      ...(who === null ? {} : { authorization: `Bearer ${admins[who].token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const code = async (res: Response) => problemSchema.parse(await res.json()).code;

async function auditRows() {
  const { rows } = await database.pool.query<{
    actor_type: string;
    actor_id: string;
    action: string;
    target_type: string;
    target_id: string;
    ip: string;
    meta: Record<string, unknown>;
  }>(
    'select actor_type, actor_id, action, target_type, target_id, ip, meta from identity.audit_logs order by occurred_at, id',
  );
  return rows;
}

async function outboxRows() {
  const { rows } = await database.pool.query<{ event_type: string; aggregate_id: string; payload: unknown }>(
    'select event_type, aggregate_id, payload from platform.outbox order by created_at',
  );
  return rows;
}

describe('phân quyền /admin/kyc', () => {
  it('chưa đăng nhập → 401, MATCHMAKER (thiếu kyc:review / kyc:decide) → 403, REVIEWER → 200', async () => {
    const { id } = await seed({ ready: true });
    const routes: [string, string, unknown?][] = [
      ['GET', '/admin/kyc/submissions'],
      ['GET', `/admin/kyc/submissions/${id}`],
      ['POST', `/admin/kyc/submissions/${id}/assign`],
      ['POST', `/admin/kyc/submissions/${id}/steps`, { step: 'MANUAL_REVIEW', outcome: 'PASSED' }],
      ['POST', `/admin/kyc/submissions/${id}/request-more-info`, { items: ['SELFIE'] }],
      ['POST', `/admin/kyc/submissions/${id}/reject`, { code: 'FACE_MISMATCH' }],
      ['POST', `/admin/kyc/submissions/${id}/approve`],
    ];
    for (const [method, path, body] of routes) {
      const anon = await call(method, path, null, body);
      expect(anon.status, `${method} ${path}`).toBe(401);
      const mm = await call(method, path, 'matchmaker', body);
      expect(mm.status, `${method} ${path}`).toBe(403);
      expect(await code(mm)).toBe('FORBIDDEN');
    }
    expect(await auditRows()).toEqual([]);

    expect((await call('GET', '/admin/kyc/submissions', 'reviewer')).status).toBe(200);
    expect((await call('GET', `/admin/kyc/submissions/${id}`, 'reviewer')).status).toBe(200);
    expect((await call('POST', `/admin/kyc/submissions/${id}/approve`, 'reviewer')).status).toBe(200);
  });
});

describe('GET /admin/kyc/submissions (hàng chờ)', () => {
  it('chờ lâu nhất trước, mặc định SUBMITTED + UNDER_REVIEW, phân trang cursor, kèm tên/nghề', async () => {
    const c = await seed({ submittedAt: new Date('2026-11-17T03:00:00.000Z') });
    const a = await seed({ submittedAt: new Date('2026-11-17T01:00:00.000Z') });
    const b = await seed({ submittedAt: new Date('2026-11-17T02:00:00.000Z'), ready: true });
    const decided = await seed({ ready: true });
    expect((await call('POST', `/admin/kyc/submissions/${decided.id}/approve`, 'reviewer')).status).toBe(200);
    directory.add({ userId: a.userId, fullName: 'Trần Thị Bình', occupation: 'Giáo viên' });

    const p1 = kycQueueResponseSchema.parse(
      await (await call('GET', '/admin/kyc/submissions?limit=2', 'reviewer')).json(),
    );
    expect(p1.items.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(p1.items[0]).toMatchObject({
      fullName: 'Trần Thị Bình',
      occupation: 'Giáo viên',
      status: 'SUBMITTED',
    });
    expect(p1.items[1]).toMatchObject({ status: 'UNDER_REVIEW', reviewerId: admins.reviewer.id });
    expect(p1.nextCursor).not.toBeNull();

    const p2 = kycQueueResponseSchema.parse(
      await (await call('GET', `/admin/kyc/submissions?limit=2&cursor=${p1.nextCursor}`, 'reviewer')).json(),
    );
    expect(p2.items.map((i) => i.id)).toEqual([c.id]);
    expect(p2.nextCursor).toBeNull();

    const approved = kycQueueResponseSchema.parse(
      await (await call('GET', '/admin/kyc/submissions?status=APPROVED,REJECTED', 'reviewer')).json(),
    );
    expect(approved.items.map((i) => i.id)).toEqual([decided.id]);

    const bad = await call('GET', '/admin/kyc/submissions?cursor=not-a-cursor', 'reviewer');
    expect(bad.status).toBe(422);
    const badStatus = await call('GET', '/admin/kyc/submissions?status=DRAFT', 'reviewer');
    expect(badStatus.status).toBe(422);
  });

  it('bộ lọc flagged (SQL) khớp định nghĩa ekycFlags() ở domain', async () => {
    const cases: (EkycAssessment | null)[] = [
      CLEAN,
      null,
      { ...CLEAN, ocr: { status: 'ERROR', reason: 'TIMEOUT' } },
      { ...CLEAN, liveness: { status: 'REJECTED', reason: 'LIVENESS_FAILED', score: 0.1 } },
      { ...CLEAN, faceMatch: { status: 'REJECTED', reason: 'FACE_MISMATCH', score: 0.2 } },
      { ...CLEAN, profileMismatches: null },
      { ...CLEAN, profileMismatches: ['BIRTH_DATE'] },
      { ...CLEAN, liveness: { status: 'OK', score: null } },
    ];
    const seeded: { id: string; assessment: EkycAssessment | null }[] = [];
    for (const assessment of cases) seeded.push({ ...(await seed({ assessment })), assessment });

    const ids = async (flagged: boolean) =>
      kycQueueResponseSchema
        .parse(await (await call('GET', `/admin/kyc/submissions?flagged=${flagged}`, 'reviewer')).json())
        .items.map((i) => i.id)
        .sort();
    const expected = (flagged: boolean) =>
      seeded
        .filter((s) => ekycFlags(s.assessment).length > 0 === flagged)
        .map((s) => s.id)
        .sort();
    expect(await ids(true)).toEqual(expected(true));
    expect(await ids(false)).toEqual(expected(false));
    expect(expected(true)).toHaveLength(6);
  });

  it('tìm theo tên/nghề qua facade profile', async () => {
    const a = await seed();
    await seed();
    directory.add({ userId: a.userId, fullName: 'Lê Minh', occupation: 'Bác sĩ' });
    const res = kycQueueResponseSchema.parse(
      await (
        await call('GET', `/admin/kyc/submissions?q=${encodeURIComponent('bác sĩ')}`, 'reviewer')
      ).json(),
    );
    expect(res.items.map((i) => i.id)).toEqual([a.id]);
  });
});

describe('GET /admin/kyc/submissions/:id (chi tiết)', () => {
  it('mỗi lần mở chi tiết tạo đúng 1 bản ghi audit (actor, target, ip) — AC1', async () => {
    const { id, cccd } = await seed();
    const res = await call('GET', `/admin/kyc/submissions/${id}`, 'reviewer');
    expect(res.status).toBe(200);
    const body = kycAdminDetailResponseSchema.parse(await res.json());
    expect(body.cccdNumber).toBe(cccd);
    expect(body.documents.cccdFront?.url).toContain('/privateKyc/kyc_doc/');
    expect(body.documents.selfie?.expiresAt).toBe('2026-11-18T01:05:00.000Z');
    expect(body.ekycAssessment?.liveness).toEqual({ status: 'OK', score: 0.97, reason: null });
    expect(body.steps.map((s) => s.step)).toEqual([...KYC_STEPS]);

    const expectedRow = {
      actor_type: 'admin',
      actor_id: admins.reviewer.id,
      action: 'kyc.view_detail',
      target_type: 'kyc_submission',
      target_id: id,
      ip: IP,
      meta: { status: 'SUBMITTED' },
    };
    expect(await auditRows()).toEqual([expectedRow]);

    await call('GET', `/admin/kyc/submissions/${id}`, 'reviewer');
    expect(await auditRows()).toEqual([expectedRow, expectedRow]);
    // Audit không chứa số CCCD.
    expect(JSON.stringify(await auditRows())).not.toContain(cccd);
  });

  it('không tồn tại → 404 KYC_SUBMISSION_NOT_FOUND, không audit; id sai định dạng → 400', async () => {
    const res = await call('GET', `/admin/kyc/submissions/${newId()}`, 'reviewer');
    expect(res.status).toBe(404);
    expect(await code(res)).toBe('KYC_SUBMISSION_NOT_FOUND');
    expect((await call('GET', '/admin/kyc/submissions/abc', 'reviewer')).status).toBe(400);
    expect(await auditRows()).toEqual([]);
  });
});

describe('quyết định', () => {
  it('nhận hồ sơ → đánh dấu bước → duyệt; KycApproved vào outbox, mỗi thao tác 1 audit', async () => {
    const { id, userId } = await seed();
    const assign = await call('POST', `/admin/kyc/submissions/${id}/assign`, 'reviewer');
    expect(kycAdminDecisionResponseSchema.parse(await assign.json())).toMatchObject({
      status: 'UNDER_REVIEW',
      reviewerId: admins.reviewer.id,
    });
    for (const step of KYC_STEPS) {
      const r = await call('POST', `/admin/kyc/submissions/${id}/steps`, 'reviewer', {
        step,
        outcome: 'PASSED',
      });
      expect(r.status).toBe(200);
    }
    const approve = await call('POST', `/admin/kyc/submissions/${id}/approve`, 'reviewer');
    expect(approve.status).toBe(200);
    expect(kycAdminDecisionResponseSchema.parse(await approve.json())).toMatchObject({
      status: 'APPROVED',
      decidedBy: admins.reviewer.id,
    });

    expect(await outboxRows()).toEqual([
      { event_type: 'KycApproved', aggregate_id: id, payload: { submissionId: id, userId } },
    ]);
    expect((await auditRows()).map((r) => r.action)).toEqual([
      'kyc.assign_reviewer',
      'kyc.mark_step',
      'kyc.mark_step',
      'kyc.mark_step',
      'kyc.mark_step',
      'kyc.approve',
    ]);
  });

  it('CCCD_CHIP đạt khi chưa có số CCCD → 409 KYC_CCCD_NUMBER_MISSING', async () => {
    const { id } = await seed({ withCccd: false });
    const res = await call('POST', `/admin/kyc/submissions/${id}/steps`, 'reviewer', {
      step: 'CCCD_CHIP',
      outcome: 'PASSED',
    });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('KYC_CCCD_NUMBER_MISSING');
  });

  it('từ chối (lý do) → KycRejected vào outbox; yêu cầu bổ sung → KycMoreInfoRequested', async () => {
    const r1 = await seed({ ready: true });
    const reject = await call('POST', `/admin/kyc/submissions/${r1.id}/reject`, 'reviewer', {
      code: 'OTHER',
      note: 'Giấy xác nhận độc thân hết hạn',
    });
    expect(reject.status).toBe(200);
    const noReason = await call('POST', `/admin/kyc/submissions/${r1.id}/reject`, 'reviewer', { code: 'X' });
    expect(await code(noReason)).toBe('REJECTION_REASON_REQUIRED');
    const rejected = await outboxRows();
    expect(rejected.map((e) => [e.event_type, e.aggregate_id])).toEqual([['KycRejected', r1.id]]);
    expect(JSON.stringify(rejected)).not.toContain('hết hạn');

    const r2 = await seed({ ready: true });
    const more = await call('POST', `/admin/kyc/submissions/${r2.id}/request-more-info`, 'reviewer', {
      items: ['SELFIE'],
      note: 'Selfie bị tối',
    });
    expect(more.status).toBe(200);
    expect((await outboxRows()).map((e) => [e.event_type, e.aggregate_id])).toEqual([
      ['KycMoreInfoRequested', r2.id],
    ]);
    expect(JSON.stringify(await auditRows())).not.toContain('hết hạn');
  });

  it('hai chuyên viên cùng duyệt / từ chối đồng thời → 1 thành công, người kia KYC_ALREADY_DECIDED — AC2', async () => {
    for (const second of ['approve', 'reject'] as const) {
      const { id } = await seed({ ready: true });
      const results = await runConcurrently(2, (i) =>
        i === 0
          ? call('POST', `/admin/kyc/submissions/${id}/approve`, 'reviewer')
          : second === 'approve'
            ? call('POST', `/admin/kyc/submissions/${id}/approve`, 'reviewer2')
            : call('POST', `/admin/kyc/submissions/${id}/reject`, 'reviewer2', { code: 'FACE_MISMATCH' }),
      );
      const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)).sort();
      expect(statuses, second).toEqual([200, 409]);
      const loser = results.find((r) => r.status === 'fulfilled' && r.value.status === 409);
      if (loser?.status !== 'fulfilled') throw new Error('missing 409');
      expect(await code(loser.value)).toBe('KYC_ALREADY_DECIDED');

      const decisions = (await outboxRows()).filter((e) => e.aggregate_id === id);
      expect(decisions).toHaveLength(1);
      const audits = (await auditRows()).filter(
        (r) => r.target_id === id && (r.action === 'kyc.approve' || r.action === 'kyc.reject'),
      );
      expect(audits).toHaveLength(1);
    }
  });

  it('event + trạng thái + audit cùng một transaction: audit lỗi → không đổi trạng thái, không event — AC3', async () => {
    const { id } = await seed({ ready: true });
    const failingAudit = new RecordingAuditLogger();
    failingAudit.failWith = 'AUDIT_ENTRY_INVALID';
    const approve = new ApproveKyc({ uow, clock, submissions: repo, auditLogger: failingAudit });
    await expect(
      approve.execute({ submissionId: id, actor: { adminId: admins.reviewer.id, ip: IP } }),
    ).rejects.toThrow();

    const { rows } = await database.pool.query<{ status: string }>(
      'select status from verification.kyc_submissions where id = $1',
      [id],
    );
    expect(rows[0]?.status).toBe('UNDER_REVIEW');
    expect(await outboxRows()).toEqual([]);
  });
});
