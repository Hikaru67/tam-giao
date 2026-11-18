import { createLogger } from '@tamgiao/config';
import { problemSchema, profileResponseSchema } from '@tamgiao/contracts';
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
import { FakeVerificationFacade } from './fakes.js';

let database: Database;
let app: Hono<AppEnv>;
let uploads: UploadService;
const clock = new FakeClock(new Date('2026-11-18T01:00:00.000Z'));
const userA = newId<'User'>();
const userB = newId<'User'>();

/** Storage giả: mọi object "đã được tải lên" đúng như khai báo; GET trả URL giả. */
const declared = new Map<string, { sizeBytes: number; contentType: string }>();
const storage: ObjectStorage = {
  presignPut: async (i) => {
    declared.set(i.key, { sizeBytes: i.sizeBytes, contentType: i.contentType });
    return { url: `https://storage.test/put/${i.key}`, method: 'PUT', headers: {}, expiresAt: clock.now() };
  },
  presignGet: async (i) => ({
    url: `https://storage.test/get/${i.key}?ttl=300`,
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
    verification: new FakeVerificationFacade(),
    requireUser,
  });
  const logger = createLogger({ service: 'api', level: 'silent', destination: { write: () => undefined } });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(logger));
  app.route('/', module.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);
});
beforeEach(() => resetDatabase(database.pool));
afterAll(() => database.close());

async function photoKey(ownerId: string): Promise<string> {
  const r = await uploads.requestUpload({
    ownerId,
    purpose: 'profile_photo',
    contentType: 'image/jpeg',
    sizeBytes: 100,
  });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value.key;
}

const put = (userId: string, body: unknown) =>
  app.request('/me/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-test-user': userId },
    body: JSON.stringify(body),
  });
const get = (userId: string) => app.request('/me/profile', { headers: { 'x-test-user': userId } });
const code = async (res: Response) => problemSchema.parse(await res.json()).code;

const form = (photos: string[]) => ({
  fullName: 'Lê Minh C',
  birthDate: '1994-08-20',
  gender: 'male',
  hometown: 'Nam Định',
  currentCity: 'Hà Nội',
  education: 'bachelor',
  occupation: 'Kế toán',
  bio: 'Thích đọc sách và nấu ăn.',
  interests: ['đọc sách', 'nấu ăn'],
  incomeRange: '20m_40m',
  housing: 'own_home',
  assets: 'Căn hộ 2 phòng ngủ tại Cầu Giấy',
  photos,
});

describe('PUT/GET /me/profile', () => {
  it('private fields are stored encrypted and returned decrypted to the owner (AC2)', async () => {
    const key = await photoKey(userA);
    const res = await put(userA, { ...form([key]), submit: true });
    expect(res.status).toBe(200);
    const body = profileResponseSchema.parse(await res.json());
    expect(body).toMatchObject({
      status: 'COMPLETED',
      incomeRange: '20m_40m',
      housing: 'own_home',
      assets: 'Căn hộ 2 phòng ngủ tại Cầu Giấy',
      photos: [{ key, url: `https://storage.test/get/${key}?ttl=300` }],
    });

    const { rows } = await database.pool.query(
      'select income_range_enc, housing_enc, assets_enc from profile.profiles where user_id = $1',
      [userA],
    );
    const raw = rows[0] as Record<string, Buffer>;
    for (const [col, plain] of [
      ['income_range_enc', '20m_40m'],
      ['housing_enc', 'own_home'],
      ['assets_enc', 'Căn hộ'],
    ] as const) {
      expect(Buffer.isBuffer(raw[col])).toBe(true);
      expect(raw[col]?.toString('utf8')).not.toContain(plain);
    }

    const again = profileResponseSchema.parse(await (await get(userA)).json());
    expect(again.assets).toBe('Căn hộ 2 phòng ngủ tại Cầu Giấy');
  });

  it('completing the profile writes ProfileCompleted to the outbox once', async () => {
    const key = await photoKey(userA);
    expect((await put(userA, { ...form([key]), submit: true })).status).toBe(200);
    expect((await put(userA, { ...form([key]), occupation: 'Kiểm toán', submit: true })).status).toBe(200);
    const { rows } = await database.pool.query(
      `select event_type, aggregate_id, payload from platform.outbox where event_type = 'ProfileCompleted'`,
    );
    expect(rows).toEqual([
      { event_type: 'ProfileCompleted', aggregate_id: userA, payload: { userId: userA } },
    ]);
  });

  it('draft save ("Lưu tạm") accepts a partial form; GET before any save → 404', async () => {
    expect((await get(userA)).status).toBe(404);
    const res = await put(userA, { fullName: 'Lê Minh C' });
    expect(res.status).toBe(200);
    expect(profileResponseSchema.parse(await res.json())).toMatchObject({
      status: 'DRAFT',
      fullName: 'Lê Minh C',
      incomeRange: null,
      photos: [],
    });
  });

  it('age below MIN_AGE → 422 AGE_NOT_ELIGIBLE (AC1)', async () => {
    const res = await put(userA, { birthDate: '2010-01-01' });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('AGE_NOT_ELIGIBLE');
  });

  it('more than 5 photos → 422 TOO_MANY_PHOTOS (AC3)', async () => {
    const keys = await Promise.all(Array.from({ length: 6 }, () => photoKey(userA)));
    const res = await put(userA, form(keys));
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('TOO_MANY_PHOTOS');
  });

  it("another user's photo key → 403 UPLOAD_NOT_OWNED", async () => {
    const theirs = await photoKey(userB);
    const res = await put(userA, form([theirs]));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('UPLOAD_NOT_OWNED');
    expect((await get(userA)).status).toBe(404);
  });

  it('submit with missing fields → 422 PROFILE_INCOMPLETE with the list', async () => {
    const res = await put(userA, { fullName: 'C', submit: true });
    expect(res.status).toBe(422);
    const problem = problemSchema.parse(await res.json());
    expect(problem.code).toBe('PROFILE_INCOMPLETE');
    expect(problem.meta).toMatchObject({
      missing: ['birthDate', 'gender', 'currentCity', 'education', 'occupation', 'photos'],
    });
  });

  it.each([
    { bio: 'x'.repeat(801) },
    { gender: 'other' },
    { birthDate: '20-08-1994' },
    { incomeRange: 'a lot' },
    { interests: Array.from({ length: 21 }, (_, i) => `tag${i}`) },
  ])('malformed body → 422 VALIDATION_FAILED %#', async (body) => {
    const res = await put(userA, body);
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('VALIDATION_FAILED');
  });

  it('requires a logged-in user', async () => {
    expect((await app.request('/me/profile')).status).toBe(401);
  });
});
