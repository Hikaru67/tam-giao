import { createLogger } from '@tamgiao/config';
import { meResponseSchema } from '@tamgiao/contracts';
import {
  DrizzleUnitOfWork,
  LocalKeyEncryptor,
  UploadService,
  createDatabase,
  type Database,
} from '@tamgiao/db';
import { handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { FakeClock, newId, type ObjectStorage } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProfileModule } from '../index.js';

let database: Database;
let app: Hono<AppEnv>;
let uploads: UploadService;
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
  const module = createProfileModule({
    uow,
    clock,
    encryptor: new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 3)]]) }),
    uploads,
    storage,
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

describe('GET /me onboarding steps (AC1)', () => {
  it('new user with no profile → PROFILE', async () => {
    const userId = newId<'User'>();
    expect(await me(userId)).toEqual({ userId, onboardingStep: 'PROFILE', profile: null, badges: [] });
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
    });
  });

  it('requires a logged-in user', async () => {
    expect((await app.request('/me')).status).toBe(401);
  });
});
