import {
  problemSchema,
  requestOtpResponseSchema,
  verifyOtpResponseSchema,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
} from '@tamgiao/contracts';
import { resetDatabase, runConcurrently } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createIdentityHarness, type IdentityHarness } from './harness.js';

const PHONE = '0912345678';
let h: IdentityHarness;

beforeAll(() => {
  h = createIdentityHarness();
});
beforeEach(async () => {
  await resetDatabase(h.database.pool);
  h.sms.sent.length = 0;
  h.logLines.length = 0;
});
afterAll(() => h.database.close());

const problemCode = async (res: Response) => problemSchema.parse(await res.json()).code;

async function requestAndGetCode(phone = PHONE, ip = '203.0.113.7'): Promise<string> {
  const res = await h.post('/auth/otp/request', { phone }, { 'x-forwarded-for': ip });
  expect(res.status).toBe(200);
  return h.sms.lastCode();
}

describe('POST /auth/otp/request', () => {
  it('200 + thời hạn; DB chỉ có blind index và hash, không có SĐT/OTP thô', async () => {
    const res = await h.post('/auth/otp/request', { phone: PHONE });
    expect(res.status).toBe(200);
    expect(requestOtpResponseSchema.parse(await res.json())).toEqual({
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: 60,
    });

    const code = h.sms.lastCode();
    const { rows: challenges } = await h.database.pool.query('select * from identity.otp_challenges');
    const { rows: hits } = await h.database.pool.query('select * from identity.rate_limit_hits');
    expect(challenges).toHaveLength(1);
    expect(hits).toHaveLength(2); // theo SĐT + theo IP
    const stored = JSON.stringify([challenges, hits]);
    for (const secret of ['912345678', code, '203.0.113.7']) expect(stored).not.toContain(secret);
  });

  it('gọi liên tục → 429 RATE_LIMITED kèm retryAfterSeconds (AC3)', async () => {
    await requestAndGetCode();
    h.clock.advance({ seconds: 15 });
    const res = await h.post('/auth/otp/request', { phone: PHONE });
    expect(res.status).toBe(429);
    const problem = problemSchema.parse(await res.json());
    expect(problem).toMatchObject({ code: 'RATE_LIMITED', meta: { retryAfterSeconds: 45 } });
    expect(h.sms.sent).toHaveLength(1);
  });

  it('10 request đồng thời cho cùng SĐT từ 10 IP → chỉ 1 SMS được gửi (AC3, A10)', async () => {
    const results = await runConcurrently(10, (i) =>
      h.post('/auth/otp/request', { phone: PHONE }, { 'x-forwarded-for': `198.51.100.${i + 1}` }),
    );
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 429)).toHaveLength(9);
    expect(h.sms.sent).toHaveLength(1);
  });

  it('SĐT sai định dạng → 422 PHONE_INVALID; body sai → 422 VALIDATION_FAILED', async () => {
    const invalid = await h.post('/auth/otp/request', { phone: '0212345678' });
    expect(invalid.status).toBe(422);
    expect(await problemCode(invalid)).toBe('PHONE_INVALID');

    const missing = await h.post('/auth/otp/request', {});
    expect(missing.status).toBe(422);
    expect(await problemCode(missing)).toBe('VALIDATION_FAILED');
    expect(h.sms.sent).toHaveLength(0);
  });
});

describe('POST /auth/otp/verify', () => {
  it('OTP đúng trong TTL → 200, tạo user (SĐT mã hoá) + outbox UserRegistered; dùng lại → OTP_INVALID (AC1)', async () => {
    const code = await requestAndGetCode();
    const res = await h.post('/auth/otp/verify', { phone: PHONE, code });
    expect(res.status).toBe(200);
    const body = verifyOtpResponseSchema.parse(await res.json());
    expect(body.isNewUser).toBe(true);

    const { rows: users } = await h.database.pool.query<{ id: string; phone_enc: Buffer }>(
      'select id, phone_enc from identity.users',
    );
    expect(users.map((u) => u.id)).toEqual([body.userId]);
    expect(users[0]?.phone_enc.toString('latin1')).not.toContain('912345678');

    const { rows: events } = await h.database.pool.query(
      'select event_type, aggregate_id, payload from platform.outbox',
    );
    expect(events).toEqual([
      { event_type: 'UserRegistered', aggregate_id: body.userId, payload: { userId: body.userId } },
    ]);

    const reused = await h.post('/auth/otp/verify', { phone: PHONE, code });
    expect(reused.status).toBe(422);
    expect(await problemCode(reused)).toBe('OTP_INVALID');
  });

  it('đăng nhập lần hai → cùng userId, isNewUser=false, không thêm event', async () => {
    const first = await h.post('/auth/otp/verify', { phone: PHONE, code: await requestAndGetCode() });
    h.clock.advance({ minutes: 2 });
    const second = await h.post('/auth/otp/verify', {
      phone: '+84912345678',
      code: await requestAndGetCode(),
    });
    const a = verifyOtpResponseSchema.parse(await first.json());
    const b = verifyOtpResponseSchema.parse(await second.json());
    expect(b).toEqual({ userId: a.userId, isNewUser: false });
    const { rows } = await h.database.pool.query('select 1 from platform.outbox');
    expect(rows).toHaveLength(1);
  });

  it('OTP hết hạn → 410 OTP_EXPIRED (AC2)', async () => {
    const code = await requestAndGetCode();
    h.clock.advance({ seconds: OTP_TTL_SECONDS });
    const res = await h.post('/auth/otp/verify', { phone: PHONE, code });
    expect(res.status).toBe(410);
    expect(await problemCode(res)).toBe('OTP_EXPIRED');
  });

  it('sai 5 lần → 429 OTP_LOCKED, số lần sai được commit dù request trả lỗi (AC2)', async () => {
    const code = await requestAndGetCode();
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      const wrong = await h.post('/auth/otp/verify', {
        phone: PHONE,
        code: '000000' === code ? '111111' : '000000',
      });
      expect(wrong.status).toBe(422);
      expect(problemSchema.parse(await wrong.json())).toMatchObject({
        code: 'OTP_INVALID',
        meta: { remainingAttempts: OTP_MAX_ATTEMPTS - i },
      });
    }
    const { rows } = await h.database.pool.query<{ failed_attempts: number }>(
      'select failed_attempts from identity.otp_challenges',
    );
    expect(rows[0]?.failed_attempts).toBe(OTP_MAX_ATTEMPTS - 1);

    const fifth = await h.post('/auth/otp/verify', {
      phone: PHONE,
      code: '000000' === code ? '111111' : '000000',
    });
    expect(fifth.status).toBe(429);
    expect(await problemCode(fifth)).toBe('OTP_LOCKED');

    const correct = await h.post('/auth/otp/verify', { phone: PHONE, code });
    expect(await problemCode(correct)).toBe('OTP_LOCKED');
    const { rows: users } = await h.database.pool.query('select 1 from identity.users');
    expect(users).toHaveLength(0);
  });

  it('30 lần đoán sai đồng thời → không vượt quá OTP_MAX_ATTEMPTS lần được tính, challenge bị khoá (A10)', async () => {
    const code = await requestAndGetCode();
    const wrong = code === '000000' ? '111111' : '000000';
    const results = await runConcurrently(30, () =>
      h.post('/auth/otp/verify', { phone: PHONE, code: wrong }),
    );
    const codes = await Promise.all(
      results.map(async (r) => (r.status === 'fulfilled' ? problemCode(r.value) : 'rejected')),
    );
    expect(codes.filter((c) => c === 'OTP_INVALID')).toHaveLength(OTP_MAX_ATTEMPTS - 1);
    expect(codes.filter((c) => c === 'OTP_LOCKED')).toHaveLength(30 - (OTP_MAX_ATTEMPTS - 1));
    const { rows } = await h.database.pool.query<{ failed_attempts: number }>(
      'select failed_attempts from identity.otp_challenges',
    );
    expect(rows[0]?.failed_attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it('5 request xác thực đúng đồng thời → đúng 1 thành công, chỉ 1 user được tạo (A10)', async () => {
    const code = await requestAndGetCode();
    const results = await runConcurrently(5, () => h.post('/auth/otp/verify', { phone: PHONE, code }));
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 422)).toHaveLength(4);
    const { rows } = await h.database.pool.query('select 1 from identity.users');
    expect(rows).toHaveLength(1);
  });

  it('mã không phải 6 chữ số → 422 VALIDATION_FAILED, không tính lần sai', async () => {
    await requestAndGetCode();
    const res = await h.post('/auth/otp/verify', { phone: PHONE, code: '12ab' });
    expect(await problemCode(res)).toBe('VALIDATION_FAILED');
    const { rows } = await h.database.pool.query<{ failed_attempts: number }>(
      'select failed_attempts from identity.otp_challenges',
    );
    expect(rows[0]?.failed_attempts).toBe(0);
  });
});

describe('log (AC4)', () => {
  it('SĐT và OTP không xuất hiện trong log ở mọi nhánh: thành công, sai mã, rate limit, validate lỗi', async () => {
    const code = await requestAndGetCode();
    await h.post('/auth/otp/request', { phone: PHONE }); // rate limited
    await h.post('/auth/otp/verify', { phone: PHONE, code: code === '000000' ? '111111' : '000000' });
    await h.post('/auth/otp/verify', { phone: PHONE, code });
    await h.post('/auth/otp/verify', { phone: PHONE, code: 'not-a-code' });
    await h.post('/auth/otp/request', { phone: '0912 345 678 9999' });

    const raw = h.logLines.join('\n');
    expect(h.logLines.length).toBeGreaterThanOrEqual(6);
    for (const secret of ['912345678', '0912 345 678', code]) expect(raw).not.toContain(secret);
  });
});
