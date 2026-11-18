import { adminLoginResponseSchema, adminMeResponseSchema, problemSchema } from '@tamgiao/contracts';
import { resetDatabase, runConcurrently } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_LOCK_MINUTES, ADMIN_MAX_FAILED_LOGINS } from '../domain/admin-user.js';
import { Rfc6238Totp } from '../infrastructure/rfc6238-totp.js';
import { createIdentityHarness, type IdentityHarness } from './harness.js';

const PASSWORD = 'correct horse battery staple';
const totp = new Rfc6238Totp();
let h: IdentityHarness;

beforeAll(() => {
  h = createIdentityHarness();
  // Route giả lập "duyệt eKYC" của module khác, dùng guard do identity cung cấp.
  h.app.get('/admin/kyc/queue', h.module.requireAdmin('kyc:review'), (c) => c.json({ ok: true }));
});
beforeEach(async () => {
  await resetDatabase(h.database.pool);
  h.logLines.length = 0;
});
afterAll(() => h.database.close());

const problemCode = async (res: Response) => problemSchema.parse(await res.json()).code;

async function seedAdmin(email: string, role: string): Promise<string> {
  const r = await h.module.commands.createAdminUser.execute({ email, password: PASSWORD, role });
  if (r.isErr()) throw new Error(r.error.code);
  const secret = new URL(r.value.otpauthUri).searchParams.get('secret');
  if (!secret) throw new Error('otpauth URI thiếu secret');
  return secret;
}

const login = (email: string, body: Record<string, unknown>) =>
  h.post('/admin/auth/login', { email, ...body });
const authed = (method: string, path: string, token: string) =>
  h.app.request(path, { method, headers: { authorization: `Bearer ${token}` } });

async function loginOk(email: string, secret: string): Promise<string> {
  const res = await login(email, { password: PASSWORD, totpCode: totp.generate(secret, h.clock.now()) });
  expect(res.status).toBe(200);
  return adminLoginResponseSchema.parse(await res.json()).token;
}

describe('POST /admin/auth/login', () => {
  it('đúng mật khẩu + TOTP → token; DB lưu argon2id + secret TOTP mã hoá, không lưu token thô', async () => {
    const secret = await seedAdmin('ops@tamgiao.vn', 'ADMIN');
    const token = await loginOk('OPS@tamgiao.vn', secret);

    const me = await authed('GET', '/admin/auth/me', token);
    expect(me.status).toBe(200);
    expect(adminMeResponseSchema.parse(await me.json()).role).toBe('ADMIN');

    const { rows } = await h.database.pool.query(
      'select a.password_hash, a.totp_secret_enc, s.token_hash from identity.admin_users a join identity.admin_sessions s on s.admin_id = a.id',
    );
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const stored = JSON.stringify(rows) + Buffer.from(rows[0].totp_secret_enc).toString('latin1');
    for (const secretValue of [secret, token, PASSWORD]) expect(stored).not.toContain(secretValue);
  });

  it('đúng mật khẩu, thiếu TOTP → 401 MFA_REQUIRED; sai TOTP → 401 INVALID_CREDENTIALS (AC1)', async () => {
    const secret = await seedAdmin('ops@tamgiao.vn', 'ADMIN');
    const missing = await login('ops@tamgiao.vn', { password: PASSWORD });
    expect(missing.status).toBe(401);
    expect(await problemCode(missing)).toBe('MFA_REQUIRED');

    const right = totp.generate(secret, h.clock.now());
    const wrong = right === '000000' ? '111111' : '000000';
    const bad = await login('ops@tamgiao.vn', { password: PASSWORD, totpCode: wrong });
    expect(bad.status).toBe(401);
    expect(await problemCode(bad)).toBe('INVALID_CREDENTIALS');

    const { rows } = await h.database.pool.query('select count(*)::int as n from identity.admin_sessions');
    expect(rows[0].n).toBe(0);
  });

  it('dùng lại mã TOTP vừa đăng nhập → INVALID_CREDENTIALS', async () => {
    const secret = await seedAdmin('ops@tamgiao.vn', 'ADMIN');
    const code = totp.generate(secret, h.clock.now());
    expect((await login('ops@tamgiao.vn', { password: PASSWORD, totpCode: code })).status).toBe(200);
    const replay = await login('ops@tamgiao.vn', { password: PASSWORD, totpCode: code });
    expect(await problemCode(replay)).toBe('INVALID_CREDENTIALS');
  });

  it(`10 lần sai đồng thời → khoá đúng sau ${ADMIN_MAX_FAILED_LOGINS} lần; ${ADMIN_LOCK_MINUTES} phút sau đăng nhập được (AC3, A10)`, async () => {
    const secret = await seedAdmin('ops@tamgiao.vn', 'ADMIN');
    const results = await runConcurrently(10, () =>
      login('ops@tamgiao.vn', {
        password: 'wrong password!!',
        totpCode: totp.generate(secret, h.clock.now()),
      }),
    );
    const codes = await Promise.all(
      results.map(async (r) => (r.status === 'fulfilled' ? problemCode(r.value) : 'rejected')),
    );
    expect(codes.filter((c) => c === 'INVALID_CREDENTIALS')).toHaveLength(ADMIN_MAX_FAILED_LOGINS - 1);
    expect(codes.filter((c) => c === 'ADMIN_LOCKED')).toHaveLength(10 - (ADMIN_MAX_FAILED_LOGINS - 1));

    const stillLocked = await login('ops@tamgiao.vn', {
      password: PASSWORD,
      totpCode: totp.generate(secret, h.clock.now()),
    });
    expect(stillLocked.status).toBe(429);
    expect(await problemCode(stillLocked)).toBe('ADMIN_LOCKED');

    h.clock.advance({ minutes: ADMIN_LOCK_MINUTES });
    await loginOk('ops@tamgiao.vn', secret);
  });

  it('email không tồn tại → 401 INVALID_CREDENTIALS (giống sai mật khẩu)', async () => {
    const res = await login('nobody@tamgiao.vn', { password: PASSWORD, totpCode: '123456' });
    expect(res.status).toBe(401);
    expect(await problemCode(res)).toBe('INVALID_CREDENTIALS');
  });

  it('mật khẩu và mã TOTP không xuất hiện trong log', async () => {
    const secret = await seedAdmin('ops@tamgiao.vn', 'ADMIN');
    const code = totp.generate(secret, h.clock.now());
    await login('ops@tamgiao.vn', { password: PASSWORD, totpCode: code });
    const logs = h.logLines.join('\n');
    for (const value of [PASSWORD, code, secret]) expect(logs).not.toContain(value);
  });
});

describe('requireAdmin trên route thật', () => {
  it('MATCHMAKER gọi route kyc:review → 403 FORBIDDEN; REVIEWER → 200 (AC2)', async () => {
    const mmSecret = await seedAdmin('mm@tamgiao.vn', 'MATCHMAKER');
    const rvSecret = await seedAdmin('rv@tamgiao.vn', 'REVIEWER');
    const mm = await loginOk('mm@tamgiao.vn', mmSecret);
    const rv = await loginOk('rv@tamgiao.vn', rvSecret);

    const forbidden = await authed('GET', '/admin/kyc/queue', mm);
    expect(forbidden.status).toBe(403);
    expect(await problemCode(forbidden)).toBe('FORBIDDEN');
    expect((await authed('GET', '/admin/kyc/queue', rv)).status).toBe(200);
    expect((await h.app.request('/admin/kyc/queue')).status).toBe(401);
  });

  it('logout → token hết hiệu lực ngay', async () => {
    const secret = await seedAdmin('ops@tamgiao.vn', 'ADMIN');
    const token = await loginOk('ops@tamgiao.vn', secret);
    expect((await authed('POST', '/admin/auth/logout', token)).status).toBe(204);
    expect((await authed('GET', '/admin/auth/me', token)).status).toBe(401);
  });
});

describe('Seed admin', () => {
  it('email trùng (khác hoa/thường) → ADMIN_EMAIL_TAKEN nhờ unique ở DB', async () => {
    await seedAdmin('ops@tamgiao.vn', 'ADMIN');
    const r = await h.module.commands.createAdminUser.execute({
      email: 'OPS@tamgiao.vn',
      password: PASSWORD,
      role: 'REVIEWER',
    });
    expect(r.isErr() && r.error.code).toBe('ADMIN_EMAIL_TAKEN');
  });
});
