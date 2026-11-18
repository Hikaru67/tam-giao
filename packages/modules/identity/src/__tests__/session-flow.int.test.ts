import {
  authTokensSchema,
  listSessionsResponseSchema,
  problemSchema,
  verifyOtpResponseSchema,
} from '@tamgiao/contracts';
import { resetDatabase, runConcurrently } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_TTL_SECONDS } from '../domain/session.js';
import { createIdentityHarness, type IdentityHarness } from './harness.js';

const PHONE = '0912345678';
let h: IdentityHarness;

beforeAll(() => {
  h = createIdentityHarness();
});
beforeEach(async () => {
  await resetDatabase(h.database.pool);
  h.sms.sent.length = 0;
});
afterAll(() => h.database.close());

const problemCode = async (res: Response) => problemSchema.parse(await res.json()).code;

async function login(deviceName = 'iPhone 15', ip = '203.0.113.7') {
  h.clock.advance({ minutes: 5 }); // qua cooldown gửi lại OTP
  await h.post('/auth/otp/request', { phone: PHONE }, { 'x-forwarded-for': ip });
  const res = await h.post('/auth/otp/verify', { phone: PHONE, code: h.sms.lastCode(), deviceName });
  expect(res.status).toBe(200);
  return verifyOtpResponseSchema.parse(await res.json()).tokens;
}

const refresh = (refreshToken: string) => h.post('/auth/refresh', { refreshToken });
const authed = (method: string, path: string, accessToken: string) =>
  h.app.request(path, { method, headers: { authorization: `Bearer ${accessToken}` } });

describe('POST /auth/otp/verify → phát token', () => {
  it('trả access/refresh token; DB chỉ lưu hash của refresh token', async () => {
    const tokens = await login();
    expect(tokens.accessTokenExpiresInSeconds).toBe(ACCESS_TOKEN_TTL_SECONDS);
    const { rows } = await h.database.pool.query('select token_hash from identity.refresh_tokens');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(tokens.refreshToken);
  });
});

describe('POST /auth/refresh', () => {
  it('xoay vòng → token mới; dùng lại token cũ → 401 TOKEN_REUSED và cả phiên bị thu hồi (AC1)', async () => {
    const first = await login();
    const res = await refresh(first.refreshToken);
    expect(res.status).toBe(200);
    const second = authTokensSchema.parse(await res.json());
    expect(second.sessionId).toBe(first.sessionId);

    const reused = await refresh(first.refreshToken);
    expect(reused.status).toBe(401);
    expect(await problemCode(reused)).toBe('TOKEN_REUSED');

    expect(await problemCode(await refresh(second.refreshToken))).toBe('UNAUTHENTICATED');
    const me = await authed('GET', '/auth/sessions', second.accessToken);
    expect(me.status).toBe(401);

    const { rows } = await h.database.pool.query('select revoke_reason from identity.sessions');
    expect(rows).toEqual([{ revoke_reason: 'REFRESH_TOKEN_REUSED' }]);
  });

  it('nhiều request refresh đồng thời cùng một token → đúng 1 thành công (khoá dòng)', async () => {
    const first = await login();
    const results = await runConcurrently(5, () => refresh(first.refreshToken));
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 401)).toHaveLength(4);
  });

  it('token không tồn tại → 401 UNAUTHENTICATED', async () => {
    const res = await refresh('x'.repeat(43));
    expect(res.status).toBe(401);
    expect(await problemCode(res)).toBe('UNAUTHENTICATED');
  });
});

describe('requireUser trên route thật (AC2)', () => {
  it('thiếu token → 401 UNAUTHENTICATED; quá 15 phút → 401 TOKEN_EXPIRED', async () => {
    const tokens = await login();
    const missing = await h.app.request('/auth/sessions');
    expect(missing.status).toBe(401);
    expect(await problemCode(missing)).toBe('UNAUTHENTICATED');

    h.clock.advance({ seconds: ACCESS_TOKEN_TTL_SECONDS });
    const expired = await authed('GET', '/auth/sessions', tokens.accessToken);
    expect(expired.status).toBe(401);
    expect(await problemCode(expired)).toBe('TOKEN_EXPIRED');
  });
});

describe('Danh sách thiết bị, logout', () => {
  it('liệt kê thiết bị, gỡ thiết bị khác, logout chặn ngay access token', async () => {
    const phone = await login('iPhone');
    const tablet = await login('iPad', '198.51.100.9');

    const list = await authed('GET', '/auth/sessions', phone.accessToken);
    expect(list.status).toBe(200);
    const { items } = listSessionsResponseSchema.parse(await list.json());
    expect(items.map((s) => [s.deviceName, s.current]).sort()).toEqual([
      ['iPad', false],
      ['iPhone', true],
    ]);

    const removed = await authed('DELETE', `/auth/sessions/${tablet.sessionId}`, phone.accessToken);
    expect(removed.status).toBe(204);
    expect((await authed('GET', '/auth/sessions', tablet.accessToken)).status).toBe(401);

    const logout = await authed('POST', '/auth/logout', phone.accessToken);
    expect(logout.status).toBe(204);
    expect((await authed('GET', '/auth/sessions', phone.accessToken)).status).toBe(401);
    expect(await problemCode(await refresh(phone.refreshToken))).toBe('UNAUTHENTICATED');
  });

  it('gỡ phiên không thuộc mình / id sai → 404 NOT_FOUND', async () => {
    const tokens = await login();
    const res = await authed('DELETE', '/auth/sessions/not-a-uuid', tokens.accessToken);
    expect(res.status).toBe(404);
    expect(await problemCode(res)).toBe('NOT_FOUND');
  });
});
