import { createLogger } from '@tamgiao/config';
import { preferencesResponseSchema, problemSchema } from '@tamgiao/contracts';
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
import { FakeBillingFacade, FakeVerificationFacade } from './fakes.js';

let database: Database;
let app: Hono<AppEnv>;
const clock = new FakeClock(new Date('2026-11-18T01:00:00.000Z'));
const userA = newId<'User'>();
const storage: ObjectStorage = {
  presignPut: async () => {
    throw new Error('not used');
  },
  presignGet: async (i) => ({
    url: `https://s.test/${i.key}`,
    method: 'GET',
    headers: {},
    expiresAt: clock.now(),
  }),
  head: async () => null,
  delete: async () => undefined,
};

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  const uow = new DrizzleUnitOfWork(database.pool);
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
    uploads: new UploadService({ uow, clock, storage, putTtlSeconds: 300 }),
    storage,
    verification: new FakeVerificationFacade(),
    billing: new FakeBillingFacade(),
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

const body = {
  ageMin: 26,
  ageMax: 34,
  area: { city: 'TP Hồ Chí Minh', radiusKm: 20 },
  childrenPlan: 'open',
  religion: 'buddhism',
  lifestyle: { smoking: 'never', drinking: 'not_important', dailyRhythm: 'early_bird', sports: 'regularly' },
  minEducation: 'college',
  financialIndependence: 'preferred',
  coreTraits: ['loyal', 'patient', 'humorous'],
};
const put = (b: unknown, user = userA) =>
  app.request('/me/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-test-user': user },
    body: JSON.stringify(b),
  });
const code = async (res: Response) => problemSchema.parse(await res.json()).code;

describe('PUT/GET /me/preferences', () => {
  it('saves and reads back; hard filters are SQL columns, the rest is jsonb', async () => {
    expect((await app.request('/me/preferences', { headers: { 'x-test-user': userA } })).status).toBe(404);
    const res = await put(body);
    expect(res.status).toBe(200);
    expect(preferencesResponseSchema.parse(await res.json())).toMatchObject({ userId: userA, ...body });

    const { rows } = await database.pool.query(
      `select age_min, age_max, area_city, area_radius_km, children_plan, religion, min_education, details
         from profile.preferences where user_id = $1`,
      [userA],
    );
    expect(rows[0]).toEqual({
      age_min: 26,
      age_max: 34,
      area_city: 'TP Hồ Chí Minh',
      area_radius_km: 20,
      children_plan: 'open',
      religion: 'buddhism',
      min_education: 'college',
      details: {
        lifestyle: body.lifestyle,
        financialIndependence: 'preferred',
        coreTraits: body.coreTraits,
      },
    });

    // Matching sẽ lọc được bằng SQL thuần trên cột riêng.
    const match = await database.pool.query(
      `select user_id from profile.preferences where $1::int between age_min and age_max and religion in ('buddhism', 'not_important')`,
      [30],
    );
    expect(match.rows).toEqual([{ user_id: userA }]);

    const got = await app.request('/me/preferences', { headers: { 'x-test-user': userA } });
    expect(preferencesResponseSchema.parse(await got.json())).toMatchObject(body);
  });

  it('each save emits PreferencesUpdated to the outbox', async () => {
    await put(body);
    await put({ ...body, ageMax: 40 });
    const { rows } = await database.pool.query(
      `select aggregate_version from platform.outbox where event_type = 'PreferencesUpdated' and aggregate_id = $1 order by aggregate_version`,
      [userA],
    );
    expect(rows).toEqual([{ aggregate_version: 1 }, { aggregate_version: 2 }]);
  });

  it.each([[['loyal', 'patient']], [['loyal', 'patient', 'humorous', 'kind']], [['loyal', 'loyal', 'kind']]])(
    'core traits %o → 422 INVALID_CORE_TRAITS (AC1)',
    async (coreTraits) => {
      const res = await put({ ...body, coreTraits });
      expect(res.status).toBe(422);
      expect(await code(res)).toBe('INVALID_CORE_TRAITS');
    },
  );

  it.each([
    { ageMin: 35, ageMax: 30 },
    { ageMin: 19, ageMax: 30 },
    { ageMin: 30, ageMax: 81 },
  ])('age range %o → 422 VALIDATION_FAILED (AC2)', async (ages) => {
    const res = await put({ ...body, ...ages });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('VALIDATION_FAILED');
  });

  it.each([
    { religion: 'jedi' },
    { lifestyle: { smoking: 'never' } },
    { area: { city: 'Huế', radiusKm: 0 } },
  ])('malformed body → 422 VALIDATION_FAILED %#', async (patch) => {
    const res = await put({ ...body, ...patch });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('VALIDATION_FAILED');
  });
});
