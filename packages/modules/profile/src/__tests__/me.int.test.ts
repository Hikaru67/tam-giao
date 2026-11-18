import { createLogger } from '@tamgiao/config';
import { meResponseSchema } from '@tamgiao/contracts';
import {
  DrizzleUnitOfWork,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  UploadService,
  createDatabase,
  type Database,
} from '@tamgiao/db';
import { createRequireAdmin, handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { FakeClock, fail, newId, ok, type ObjectStorage } from '@tamgiao/kernel';
import { FakeEkycProvider, createVerificationModule } from '@tamgiao/module-verification';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProfileModule } from '../index.js';
import { FakeBillingFacade } from './fakes.js';

let database: Database;
let app: Hono<AppEnv>;
let uploads: UploadService;
/** Facade billing giả — mặc định đã thanh toán xác thực (BE-S4-03). */
const billing = new FakeBillingFacade();
const clock = new FakeClock(new Date('2026-11-18T01:00:00.000Z'));
const declared = new Map<string, { sizeBytes: number; contentType: string }>();
const storage: ObjectStorage = {
  presignPut: async (i) => {
    declared.set(i.key, { sizeBytes: i.sizeBytes, contentType: i.contentType });
    return { url: 'https://s.test/put', method: 'PUT', headers: {}, expiresAt: clock.now() };
  },
  presignGet: async (i) => ({
    url: `https://s.test/get/${i.key}`,
    method: 'GET',
    headers: {},
    expiresAt: clock.now(),
  }),
  head: async (_b, key) => declared.get(key) ?? null,
  delete: async () => undefined,
};

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  const uow = new DrizzleUnitOfWork(database.pool);
  uploads = new UploadService({ uow, clock, storage, putTtlSeconds: 300 });
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const encryptor = new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 3)]]) });
  // Facade verification thật (đọc `verification.kyc_submissions`) — nối như composition root.
  const verification = createVerificationModule({
    uow,
    clock,
    encryptor,
    blindIndexer: new HmacBlindIndexer(Buffer.alloc(32, 9)),
    uploads,
    ekyc: new FakeEkycProvider(),
    applicants: { getApplicantIdentity: async () => null },
    payments: billing,
    requireUser,
    applicantDirectory: { searchUserIds: async () => [], getApplicantSummaries: async () => [] },
    storage,
    requireAdmin: createRequireAdmin(async () => fail('UNAUTHENTICATED')),
    auditLogger: { log: async () => ok(undefined) },
  });
  const module = createProfileModule({
    uow,
    clock,
    encryptor,
    uploads,
    storage,
    verification: verification.facade,
    billing,
    requireUser,
  });
  app = new Hono<AppEnv>();
  app.use(
    '*',
    requestContext(
      createLogger({ service: 'api', level: 'silent', destination: { write: () => undefined } }),
    ),
  );
  app.route('/', module.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);
});
beforeEach(() => resetDatabase(database.pool));
afterAll(() => database.close());

const request = (method: string, path: string, userId: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': userId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const me = async (userId: string) => {
  const res = await request('GET', '/me', userId);
  expect(res.status).toBe(200);
  return meResponseSchema.parse(await res.json());
};

async function completeProfile(userId: string): Promise<string> {
  const ticket = await uploads.requestUpload({
    ownerId: userId,
    purpose: 'profile_photo',
    contentType: 'image/png',
    sizeBytes: 10,
  });
  if (ticket.isErr()) throw new Error(ticket.error.code);
  const res = await request('PUT', '/me/profile', userId, {
    fullName: 'Phạm Thu D',
    birthDate: '1998-11-18',
    gender: 'female',
    currentCity: 'Cần Thơ',
    education: 'bachelor',
    occupation: 'Dược sĩ',
    photos: [ticket.value.key],
    submit: true,
  });
  expect(res.status).toBe(200);
  return ticket.value.key;
}

const preferences = {
  ageMin: 27,
  ageMax: 35,
  area: { city: null, radiusKm: null },
  childrenPlan: 'want_children',
  religion: 'not_important',
  lifestyle: {
    smoking: 'never',
    drinking: 'not_important',
    dailyRhythm: 'flexible',
    sports: 'not_important',
  },
  minEducation: null,
  financialIndependence: 'required',
  coreTraits: ['honest', 'kind', 'family_oriented'],
};

type StepStatus = 'PENDING' | 'PASSED' | 'FAILED';

/** Seed hồ sơ eKYC trực tiếp trong bảng của verification (chỉ test; module profile không đọc bảng này). */
async function seedKyc(
  userId: string,
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'NEEDS_MORE_INFO' | 'APPROVED' | 'REJECTED',
  steps: Partial<Record<'CCCD_CHIP' | 'MARITAL_STATUS' | 'MANUAL_REVIEW' | 'INTERVIEW', StepStatus>> = {},
): Promise<void> {
  const now = clock.now();
  const step = (name: keyof typeof steps) => {
    const s = steps[name] ?? 'PENDING';
    return { status: s, decidedAt: s === 'PENDING' ? null : now.toISOString() };
  };
  const decided = status === 'APPROVED' || status === 'REJECTED';
  await database.pool.query(
    `insert into verification.kyc_submissions
       (id, user_id, status, steps, more_info_request, rejection_code, created_at, submitted_at, decided_at, updated_at, version)
     values ($1, $2, $3, $4, $5, $6, $7, $7, $8, $7, 1)`,
    [
      newId(),
      userId,
      status,
      JSON.stringify({
        CCCD_CHIP: step('CCCD_CHIP'),
        MARITAL_STATUS: step('MARITAL_STATUS'),
        MANUAL_REVIEW: step('MANUAL_REVIEW'),
        INTERVIEW: step('INTERVIEW'),
      }),
      status === 'NEEDS_MORE_INFO'
        ? JSON.stringify({ items: ['SELFIE'], note: null, requestedAt: now.toISOString() })
        : null,
      status === 'REJECTED' ? 'FACE_MISMATCH' : null,
      now,
      decided ? now : null,
    ],
  );
}

async function onboarded(): Promise<string> {
  const userId = newId<'User'>();
  await completeProfile(userId);
  expect((await request('PUT', '/me/preferences', userId, preferences)).status).toBe(200);
  return userId;
}

describe('GET /me onboarding steps (AC1)', () => {
  it('new user with no profile → PROFILE', async () => {
    const userId = newId<'User'>();
    billing.unpaid.add(userId);
    expect(await me(userId)).toEqual({
      userId,
      onboardingStep: 'PROFILE',
      profile: null,
      badges: [],
      verificationPaid: false,
    });
  });

  it('draft profile → PROFILE (with basic info so far)', async () => {
    const userId = newId<'User'>();
    expect((await request('PUT', '/me/profile', userId, { fullName: 'D' })).status).toBe(200);
    expect(await me(userId)).toMatchObject({
      onboardingStep: 'PROFILE',
      profile: { fullName: 'D', age: null, avatarUrl: null },
    });
  });

  it('completed profile without criteria → CRITERIA', async () => {
    const userId = newId<'User'>();
    await completeProfile(userId);
    expect((await me(userId)).onboardingStep).toBe('CRITERIA');
  });

  it('completed profile + criteria → VERIFICATION, with age and avatar', async () => {
    const userId = newId<'User'>();
    billing.unpaid.add(userId);
    const avatar = await completeProfile(userId);
    expect((await request('PUT', '/me/preferences', userId, preferences)).status).toBe(200);
    expect(await me(userId)).toEqual({
      userId,
      onboardingStep: 'VERIFICATION',
      profile: {
        fullName: 'Phạm Thu D',
        gender: 'female',
        age: 28,
        currentCity: 'Cần Thơ',
        avatarUrl: `https://s.test/get/${avatar}`,
      },
      badges: [],
      verificationPaid: false,
    });
  });

  it('approved verification → ACTIVE with all badges (BE-S3-07 AC1)', async () => {
    const userId = await onboarded();
    await seedKyc(userId, 'APPROVED', {
      CCCD_CHIP: 'PASSED',
      MARITAL_STATUS: 'PASSED',
      MANUAL_REVIEW: 'PASSED',
      INTERVIEW: 'PASSED',
    });
    expect(await me(userId)).toMatchObject({
      onboardingStep: 'ACTIVE',
      badges: ['CCCD_VERIFIED', 'SINGLE_VERIFIED', 'INTERVIEWED'],
    });
  });

  it.each(['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO'] as const)(
    '%s verification → UNDER_REVIEW with badges of passed steps',
    async (status) => {
      const userId = await onboarded();
      await seedKyc(userId, status, { CCCD_CHIP: 'PASSED', MARITAL_STATUS: 'FAILED' });
      expect(await me(userId)).toMatchObject({ onboardingStep: 'UNDER_REVIEW', badges: ['CCCD_VERIFIED'] });
    },
  );

  it('paid + submitted → UNDER_REVIEW with verificationPaid; submitted but unpaid → VERIFICATION (BE-S4-03)', async () => {
    const paid = await onboarded();
    await seedKyc(paid, 'SUBMITTED');
    expect(await me(paid)).toMatchObject({ onboardingStep: 'UNDER_REVIEW', verificationPaid: true });

    const unpaid = await onboarded();
    billing.unpaid.add(unpaid);
    await seedKyc(unpaid, 'SUBMITTED');
    expect(await me(unpaid)).toMatchObject({ onboardingStep: 'VERIFICATION', verificationPaid: false });
  });

  it('rejected verification → REJECTED without badges', async () => {
    const userId = await onboarded();
    await seedKyc(userId, 'REJECTED', { CCCD_CHIP: 'PASSED' });
    expect(await me(userId)).toMatchObject({ onboardingStep: 'REJECTED', badges: [] });
  });

  it('profile step still wins over an approved verification', async () => {
    const userId = newId<'User'>();
    await seedKyc(userId, 'APPROVED', { CCCD_CHIP: 'PASSED' });
    expect(await me(userId)).toMatchObject({ onboardingStep: 'PROFILE', badges: ['CCCD_VERIFIED'] });
  });

  it('requires a logged-in user', async () => {
    expect((await app.request('/me')).status).toBe(401);
  });
});
