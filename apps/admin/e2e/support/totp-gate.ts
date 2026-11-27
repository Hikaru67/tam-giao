import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { totp } from '../../../../tests/e2e/src/lib/crypto.js';
import type { AdminSession } from '../../../../tests/e2e/src/lib/flow.js';
import { sleep, type ApiClient } from '../../../../tests/e2e/src/lib/http.js';
import { E2E_RUN_DIR, type AdminCredentials } from './env';

const TOTP_STEP_MS = 30_000;
const MIN_REMAINING_MS = 3_000;
const TOTP_STEP_FILE = join(E2E_RUN_DIR, 'totp-last-step');

function readLastStep(): number | null {
  if (!existsSync(TOTP_STEP_FILE)) return null;
  const raw = readFileSync(TOTP_STEP_FILE, 'utf8').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Trả mã TOTP ở một bước 30s CHƯA từng dùng (theo file `${E2E_RUN_DIR}/totp-last-step`), ghi lại bước đã dùng. */
export async function nextTotpCode(secret: string): Promise<string> {
  const last = readLastStep();
  let now = Date.now();
  let step = Math.floor(now / TOTP_STEP_MS);

  // BE từ chối mã thuộc bước <= bước đã dùng gần nhất → chờ sang bước kế.
  if (last !== null && step <= last) {
    const waitMs = (last + 1) * TOTP_STEP_MS - now + 500;
    if (waitMs > 0) await sleep(waitMs);
    now = Date.now();
    step = Math.floor(now / TOTP_STEP_MS);
  }

  // Nếu bước hiện tại sắp hết hạn (< 3s) thì chờ sang bước kế để tránh race khi gửi lên BE.
  const remainingMs = (step + 1) * TOTP_STEP_MS - now;
  if (remainingMs < MIN_REMAINING_MS) {
    await sleep(remainingMs + 500);
    now = Date.now();
    step = Math.floor(now / TOTP_STEP_MS);
  }

  const code = totp(secret, new Date(step * TOTP_STEP_MS + 1_000));
  mkdirSync(E2E_RUN_DIR, { recursive: true });
  writeFileSync(TOTP_STEP_FILE, String(step), { encoding: 'utf8', mode: 0o600 });
  return code;
}

/** Đăng nhập API admin qua cổng TOTP để không đụng bước đã dùng với các lượt test trình duyệt. */
export async function adminApiLogin(api: ApiClient, creds: AdminCredentials): Promise<AdminSession> {
  const res = await api.post<{ token: string }>('/admin/auth/login', {
    email: creds.email,
    password: creds.password,
    totpCode: await nextTotpCode(creds.totpSecret),
  });
  return { token: res.token, http: api };
}
