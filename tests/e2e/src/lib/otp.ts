import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { sleep } from './http.js';

/**
 * Đọc OTP từ "SMS giả" (`SMS_PROVIDER=console` in `[sms:dev] to=<E.164> text=…` ra stdout của API) — cùng cách với
 * `tools/scripts/smoke-staging.ts`. Nguồn log:
 * - `E2E_OTP_LOG_FILE`: file stdout của API (chạy local bằng `tests/e2e/run-local.sh`).
 * - `E2E_OTP_COMMAND`: lệnh shell in log API gần đây (staging: `ssh deploy@host "cd /opt/tamgiao && docker compose logs --since 10m api"`).
 */
export type OtpSource = () => Promise<string>;

export function otpSourceFromEnv(env: NodeJS.ProcessEnv): OtpSource {
  const file = env.E2E_OTP_LOG_FILE;
  if (file) return () => readFile(file, 'utf8');
  const command = env.E2E_OTP_COMMAND;
  if (command) {
    return async () => {
      const { stdout, stderr } = await promisify(execFile)('/bin/sh', ['-c', command], {
        maxBuffer: 256 * 1024 * 1024,
      });
      return `${stdout}\n${stderr}`;
    };
  }
  throw new Error('Cần E2E_OTP_LOG_FILE hoặc E2E_OTP_COMMAND để đọc OTP từ SMS giả');
}

/** 9 số cuối của SĐT — so khớp giữa số người dùng nhập (0912…) và E.164 trong log (+84912…). */
const phoneTail = (phone: string): string => phone.replace(/\D/g, '').slice(-9);

/** Mã 6 số cuối cùng gửi tới mỗi SĐT trong `logs` (key = 9 số cuối). */
export function extractOtps(logs: string): Map<string, string> {
  const codes = new Map<string, string>();
  for (const line of logs.split('\n')) {
    const match = /\[sms:dev\] to=(\S+) text=.*?(?<!\d)(\d{6})(?!\d)/.exec(line);
    if (match?.[1] && match[2]) codes.set(phoneTail(match[1]), match[2]);
  }
  return codes;
}

/**
 * Chờ tới khi có OTP cho mọi SĐT trong `phones` (đọc log nhiều lần). Gọi **sau** khi đã `POST /auth/otp/request`
 * cho cả nhóm — một lần đọc log phục vụ nhiều người dùng (seed tải).
 */
export async function waitForOtps(
  source: OtpSource,
  phones: readonly string[],
  { attempts = 20, intervalMs = 500 }: { attempts?: number; intervalMs?: number } = {},
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let i = 0; i < attempts && result.size < phones.length; i++) {
    if (i > 0) await sleep(intervalMs);
    const codes = extractOtps(await source());
    for (const phone of phones) {
      const code = codes.get(phoneTail(phone));
      if (code !== undefined) result.set(phone, code);
    }
  }
  const missing = phones.length - result.size;
  if (missing > 0) throw new Error(`không đọc được OTP cho ${missing}/${phones.length} SĐT`);
  return result;
}
