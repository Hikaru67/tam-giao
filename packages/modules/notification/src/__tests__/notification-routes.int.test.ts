import { createLogger } from '@tamgiao/config';
import { deviceResponseSchema, notificationSettingsResponseSchema, problemSchema } from '@tamgiao/contracts';
import { DrizzleUnitOfWork, createDatabase, type Database } from '@tamgiao/db';
import { handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { FakeClock, newId } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createNotificationModule } from '../index.js';

let database: Database;
let app: Hono<AppEnv>;
const clock = new FakeClock(new Date('2026-11-20T01:00:00.000Z'));
const userA = newId<'User'>();
const userB = newId<'User'>();

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const module = createNotificationModule({ uow: new DrizzleUnitOfWork(database.pool), clock, requireUser });
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

const call = (method: string, path: string, user: string | null, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      ...(user === null ? {} : { 'x-test-user': user }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const devicesOf = async (userId: string) =>
  (await database.pool.query('select token, platform from notification.devices where user_id = $1', [userId]))
    .rows as { token: string; platform: string }[];

describe('POST /me/devices', () => {
  it('đăng ký token → 201; gửi lại cùng token giữ deviceId; token chuyển chủ khi người khác đăng ký', async () => {
    const token = 'ExponentPushToken[abc_123-XYZ]';
    const first = await call('POST', '/me/devices', userA, { token, platform: 'ios' });
    expect(first.status).toBe(201);
    const device = deviceResponseSchema.parse(await first.json());
    expect(device.platform).toBe('ios');

    const again = deviceResponseSchema.parse(
      await (await call('POST', '/me/devices', userA, { token, platform: 'android' })).json(),
    );
    expect(again.deviceId).toBe(device.deviceId);
    expect(await devicesOf(userA)).toEqual([{ token, platform: 'android' }]);

    await call('POST', '/me/devices', userB, { token, platform: 'ios' });
    expect(await devicesOf(userA)).toEqual([]);
    expect(await devicesOf(userB)).toEqual([{ token, platform: 'ios' }]);
  });

  it('token không phải Expo / platform lạ → 422; chưa đăng nhập → 401', async () => {
    const bad = await call('POST', '/me/devices', userA, { token: 'fcm-token', platform: 'ios' });
    expect(bad.status).toBe(422);
    expect(problemSchema.parse(await bad.json()).code).toBe('VALIDATION_FAILED');
    expect(
      (await call('POST', '/me/devices', userA, { token: 'ExpoPushToken[x]', platform: 'web' })).status,
    ).toBe(422);
    expect(
      (await call('POST', '/me/devices', null, { token: 'ExpoPushToken[x]', platform: 'ios' })).status,
    ).toBe(401);
  });
});

describe('DELETE /me/devices/:deviceId', () => {
  it('xoá thiết bị của chính mình → 204; không xoá được thiết bị người khác; id sai → 400', async () => {
    const created = deviceResponseSchema.parse(
      await (await call('POST', '/me/devices', userA, { token: 'ExpoPushToken[a]', platform: 'ios' })).json(),
    );
    expect((await call('DELETE', `/me/devices/${created.deviceId}`, userB)).status).toBe(204);
    expect(await devicesOf(userA)).toHaveLength(1);
    expect((await call('DELETE', `/me/devices/${created.deviceId}`, userA)).status).toBe(204);
    expect(await devicesOf(userA)).toEqual([]);
    expect((await call('DELETE', `/me/devices/${created.deviceId}`, userA)).status).toBe(204);
    const invalid = await call('DELETE', '/me/devices/not-a-uuid', userA);
    expect(invalid.status).toBe(400);
    expect(problemSchema.parse(await invalid.json()).code).toBe('INVALID_ID');
  });
});

describe('GET|PUT /me/notification-settings', () => {
  it('mặc định bật hết; lưu rồi đọc lại; nhóm ACCOUNT/SAFETY luôn bật', async () => {
    const initial = notificationSettingsResponseSchema.parse(
      await (await call('GET', '/me/notification-settings', userA)).json(),
    );
    expect(initial).toEqual({ matches: true, messages: true, dates: true, alwaysOn: ['ACCOUNT', 'SAFETY'] });

    const put = await call('PUT', '/me/notification-settings', userA, {
      matches: true,
      messages: false,
      dates: false,
    });
    expect(put.status).toBe(200);
    const expected = { matches: true, messages: false, dates: false, alwaysOn: ['ACCOUNT', 'SAFETY'] };
    expect(await put.json()).toEqual(expected);
    expect(await (await call('GET', '/me/notification-settings', userA)).json()).toEqual(expected);
    // Người khác không bị ảnh hưởng.
    expect(await (await call('GET', '/me/notification-settings', userB)).json()).toEqual(initial);
  });

  it('thiếu trường → 422', async () => {
    expect((await call('PUT', '/me/notification-settings', userA, { matches: false })).status).toBe(422);
  });
});
