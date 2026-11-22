import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

/**
 * Smoke test sau deploy staging (BE-S7-08): `/health`, `/ready`, rồi luồng OTP với SMS giả (`SMS_PROVIDER=console`):
 * yêu cầu OTP → lấy mã từ stdout của container API (`[sms:dev] to=… text=…`) → xác thực → gọi API có token.
 *
 * Chạy: `pnpm --filter @tamgiao/tools smoke:staging` với biến môi trường
 * - `SMOKE_BASE_URL` (bắt buộc): vd https://api.staging.example.com
 * - `SMOKE_PHONE`: số điện thoại test (mặc định 0900000000 — số không có thật, chỉ dùng cho staging)
 * - `SMOKE_OTP_COMMAND`: lệnh shell in log API gần đây (vd `ssh deploy@host docker logs --since 5m tamgiao-api`);
 *   hoặc `SMOKE_OTP` = mã nhập tay. Thiếu cả hai → chỉ kiểm tra health/ready + yêu cầu OTP.
 * Không in số điện thoại / mã OTP / token ra log (AGENTS.md mục 5).
 */
export interface SmokeOptions {
  readonly baseUrl: string;
  readonly phone: string;
  /** Trả về mã OTP vừa gửi tới `phone`, hoặc undefined nếu không lấy được. */
  readonly fetchOtp?: ((phone: string) => Promise<string | undefined>) | undefined;
  readonly fetch?: typeof fetch;
  readonly log?: (line: string) => void;
  /** Số lần thử `/ready` (cách nhau `readyIntervalMs`) — chờ deploy xong. */
  readonly readyAttempts?: number;
  readonly readyIntervalMs?: number;
}

export interface SmokeStep {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export class SmokeFailure extends Error {
  constructor(readonly steps: readonly SmokeStep[]) {
    super(`smoke failed at: ${steps.find((s) => !s.ok)?.name ?? 'unknown'}`);
    this.name = 'SmokeFailure';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tìm mã 6 số trong dòng `[sms:dev] to=<phone> text=…` cuối cùng gửi tới `phone` (so khớp theo 9 số cuối). */
export function extractOtp(logs: string, phone: string): string | undefined {
  const tail = phone.replace(/\D/g, '').slice(-9);
  let code: string | undefined;
  for (const line of logs.split('\n')) {
    const match = /\[sms:dev\] to=(\S+) text=.*?(?<!\d)(\d{6})(?!\d)/.exec(line);
    if (match?.[1] && match[2] && match[1].replace(/\D/g, '').endsWith(tail)) code = match[2];
  }
  return code;
}

export async function runSmoke(options: SmokeOptions): Promise<readonly SmokeStep[]> {
  const http = options.fetch ?? fetch;
  const log = options.log ?? (() => undefined);
  const base = options.baseUrl.replace(/\/+$/, '');
  const steps: SmokeStep[] = [];
  const record = (step: SmokeStep) => {
    steps.push(step);
    log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name}${step.detail ? ` — ${step.detail}` : ''}`);
    if (!step.ok) throw new SmokeFailure(steps);
  };
  const json = (path: string, body: unknown, token?: string) =>
    http(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  const health = await http(`${base}/health`);
  record({ name: 'GET /health', ok: health.status === 200, detail: `status ${health.status}` });

  const attempts = options.readyAttempts ?? 30;
  let readyStatus = 0;
  for (let i = 0; i < attempts; i++) {
    readyStatus = (await http(`${base}/ready`)).status;
    if (readyStatus === 200) break;
    if (i < attempts - 1) await sleep(options.readyIntervalMs ?? 5_000);
  }
  record({ name: 'GET /ready', ok: readyStatus === 200, detail: `status ${readyStatus}` });

  const requested = await json('/auth/otp/request', { phone: options.phone });
  record({
    name: 'POST /auth/otp/request',
    ok: requested.status === 200,
    detail: `status ${requested.status}`,
  });

  if (!options.fetchOtp) {
    record({ name: 'OTP verify', ok: true, detail: 'bỏ qua (không có SMOKE_OTP_COMMAND/SMOKE_OTP)' });
    return steps;
  }
  const code = await options.fetchOtp(options.phone);
  record({
    name: 'đọc OTP từ SMS giả',
    ok: code !== undefined,
    detail: code ? 'đã lấy mã' : 'không thấy mã',
  });

  const verified = await json('/auth/otp/verify', { phone: options.phone, code, deviceName: 'smoke-test' });
  const body = (await verified.json().catch(() => ({}))) as { tokens?: { accessToken?: string } };
  const token = body.tokens?.accessToken;
  record({
    name: 'POST /auth/otp/verify',
    ok: verified.status === 200 && typeof token === 'string',
    detail: `status ${verified.status}`,
  });

  const sessions = await http(`${base}/auth/sessions`, {
    headers: { authorization: `Bearer ${token ?? ''}` },
  });
  record({
    name: 'GET /auth/sessions (có token)',
    ok: sessions.status === 200,
    detail: `status ${sessions.status}`,
  });

  await json('/auth/logout', {}, token);
  return steps;
}

async function main(): Promise<void> {
  const baseUrl = process.env.SMOKE_BASE_URL;
  if (!baseUrl) {
    console.error('SMOKE_BASE_URL bắt buộc');
    process.exit(2);
  }
  const otpCommand = process.env.SMOKE_OTP_COMMAND;
  const fixedOtp = process.env.SMOKE_OTP;
  const fetchOtp = fixedOtp
    ? async () => fixedOtp
    : otpCommand
      ? async (phone: string) => {
          // Đợi SMS giả được ghi ra log rồi đọc (thử lại vài lần).
          for (let i = 0; i < 5; i++) {
            await sleep(2_000);
            const { stdout, stderr } = await promisify(execFile)('/bin/sh', ['-c', otpCommand], {
              maxBuffer: 32 * 1024 * 1024,
            });
            const code = extractOtp(`${stdout}\n${stderr}`, phone);
            if (code) return code;
          }
          return undefined;
        }
      : undefined;

  try {
    await runSmoke({
      baseUrl,
      phone: process.env.SMOKE_PHONE ?? '0900000000',
      fetchOtp,
      log: (line) => console.log(line),
      readyAttempts: Number(process.env.SMOKE_READY_ATTEMPTS ?? 30),
    });
    console.log('smoke OK');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'smoke failed');
    process.exit(1);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) await main();
