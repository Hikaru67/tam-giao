import { describe, expect, it } from 'vitest';
import { SmokeFailure, extractOtp, runSmoke } from './smoke-staging.js';

const PHONE = '0900000000';
const ACCESS = 'access-token-xyz';

/** API giả mô phỏng luồng OTP của staging (SMS giả ghi `[sms:dev]` ra stdout). */
function fakeApi(overrides: { readyAfter?: number; verifyStatus?: number } = {}) {
  const stdout: string[] = [];
  const calls: string[] = [];
  let readyCalls = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    calls.push(key);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    switch (key) {
      case 'GET /health':
        return json(200, { status: 'ok' });
      case 'GET /ready':
        readyCalls++;
        return readyCalls > (overrides.readyAfter ?? 0) ? json(200, { status: 'ready' }) : json(503, {});
      case 'POST /auth/otp/request':
        stdout.push(`[sms:dev] to=+84900000000 text=Ma xac thuc Tam Giao: 123456. Hieu luc 2 phut.`);
        return json(200, { expiresInSeconds: 120, resendAfterSeconds: 60 });
      case 'POST /auth/otp/verify': {
        const body = JSON.parse(String(init?.body)) as { code: string };
        if (body.code !== '123456') return json(400, { code: 'OTP_INVALID' });
        return json(overrides.verifyStatus ?? 200, {
          userId: 'u',
          isNewUser: true,
          tokens: { accessToken: ACCESS },
        });
      }
      case 'GET /auth/sessions': {
        const auth = new Headers(init?.headers).get('authorization');
        return auth === `Bearer ${ACCESS}` ? json(200, { items: [] }) : json(401, {});
      }
      case 'POST /auth/logout':
        return new Response(null, { status: 204 });
      default:
        return json(404, {});
    }
  }) as typeof fetch;
  return { fetchImpl, stdout, calls };
}

describe('extractOtp', () => {
  it('lấy mã của dòng SMS giả cuối cùng gửi tới đúng số (khớp 0xxx với +84xxx)', () => {
    const logs = [
      '{"level":30,"msg":"api listening"}',
      '[sms:dev] to=+84900000000 text=Ma xac thuc Tam Giao: 111111. Hieu luc 2 phut.',
      '[sms:dev] to=+84911111111 text=Ma xac thuc Tam Giao: 999999. Hieu luc 2 phut.',
      '[sms:dev] to=+84900000000 text=Ma xac thuc Tam Giao: 222222. Hieu luc 2 phut.',
    ].join('\n');
    expect(extractOtp(logs, '0900000000')).toBe('222222');
    expect(extractOtp(logs, '0922222222')).toBeUndefined();
  });
});

describe('runSmoke', () => {
  it('health + ready + OTP (Fake SMS) + gọi API có token → mọi bước PASS, không log SĐT/OTP/token', async () => {
    const api = fakeApi({ readyAfter: 2 });
    const lines: string[] = [];
    const steps = await runSmoke({
      baseUrl: 'https://api.staging.test/',
      phone: PHONE,
      fetch: api.fetchImpl,
      fetchOtp: async (phone) => extractOtp(api.stdout.join('\n'), phone),
      log: (l) => lines.push(l),
      readyIntervalMs: 0,
    });
    expect(steps.map((s) => [s.name, s.ok])).toEqual([
      ['GET /health', true],
      ['GET /ready', true],
      ['POST /auth/otp/request', true],
      ['đọc OTP từ SMS giả', true],
      ['POST /auth/otp/verify', true],
      ['GET /auth/sessions (có token)', true],
    ]);
    expect(api.calls.filter((c) => c === 'GET /ready')).toHaveLength(3);
    expect(lines.join('\n')).not.toMatch(/0900000000|123456|access-token/);
  });

  it('/ready không xanh sau số lần thử → SmokeFailure tại GET /ready', async () => {
    const api = fakeApi({ readyAfter: 99 });
    await expect(
      runSmoke({
        baseUrl: 'https://x.test',
        phone: PHONE,
        fetch: api.fetchImpl,
        readyAttempts: 3,
        readyIntervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(SmokeFailure);
    await expect(
      runSmoke({
        baseUrl: 'https://x.test',
        phone: PHONE,
        fetch: api.fetchImpl,
        readyAttempts: 1,
        readyIntervalMs: 0,
      }),
    ).rejects.toThrow('smoke failed at: GET /ready');
  });

  it('không lấy được OTP → fail ở bước đọc OTP; không có nguồn OTP → chỉ kiểm tra tới yêu cầu OTP', async () => {
    await expect(
      runSmoke({
        baseUrl: 'https://x.test',
        phone: PHONE,
        fetch: fakeApi().fetchImpl,
        fetchOtp: async () => undefined,
        readyIntervalMs: 0,
      }),
    ).rejects.toThrow('smoke failed at: đọc OTP từ SMS giả');

    const steps = await runSmoke({ baseUrl: 'https://x.test', phone: PHONE, fetch: fakeApi().fetchImpl });
    expect(steps.at(-1)).toMatchObject({ name: 'OTP verify', ok: true });
  });

  it('verify trả lỗi → fail ở POST /auth/otp/verify', async () => {
    const api = fakeApi({ verifyStatus: 500 });
    await expect(
      runSmoke({
        baseUrl: 'https://x.test',
        phone: PHONE,
        fetch: api.fetchImpl,
        fetchOtp: async (p) => extractOtp(api.stdout.join('\n'), p),
      }),
    ).rejects.toThrow('smoke failed at: POST /auth/otp/verify');
  });
});
