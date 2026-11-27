import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdminCredentials, FlowConfig } from '../../../../tests/e2e/src/lib/flow.js';
import { ApiClient } from '../../../../tests/e2e/src/lib/http.js';
import { otpSourceFromEnv } from '../../../../tests/e2e/src/lib/otp.js';

export type { AdminCredentials };

export const BROWSER_PROJECTS = ['chromium', 'webkit'] as const;

export const REPO_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const E2E_RUN_DIR: string = process.env.E2E_RUN_DIR ?? join(REPO_ROOT, 'tests/e2e/.run');
export const API_BASE_URL: string = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
/** Cổng Vite của web admin/partner khi chạy E2E (đổi được nếu máy đang bận cổng mặc định; nhớ thêm vào CORS_ORIGINS). */
export const ADMIN_WEB_PORT: number = Number(process.env.E2E_ADMIN_PORT ?? 5173);
export const PARTNER_WEB_PORT: number = Number(process.env.E2E_PARTNER_PORT ?? 5174);

/** Đọc file KEY=VALUE đơn giản (bỏ dòng trống và comment `#`). */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const result: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/** Nạp tài khoản chuyên viên ADMIN từ env hoặc `tests/e2e/.run/admin.env`. */
export function loadAdminCredentials(): AdminCredentials {
  const fromFile: Record<string, string> =
    process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD && process.env.E2E_ADMIN_TOTP_SECRET
      ? {}
      : parseEnvFile(join(E2E_RUN_DIR, 'admin.env'));

  const email = process.env.E2E_ADMIN_EMAIL || fromFile.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD || fromFile.E2E_ADMIN_PASSWORD;
  const totpSecret = process.env.E2E_ADMIN_TOTP_SECRET || fromFile.E2E_ADMIN_TOTP_SECRET;

  if (!email || !password || !totpSecret) {
    throw new Error(
      'Thiếu thông tin đăng nhập admin (E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET). ' +
        'Hãy chạy `tests/e2e/run-local.sh up` trước.',
    );
  }

  return { email, password, totpSecret };
}

/** Lấy secret ký webhook thanh toán giả từ env hoặc `tests/e2e/local.env`. */
export function webhookSecret(): string | undefined {
  if (process.env.E2E_WEBHOOK_SECRET) return process.env.E2E_WEBHOOK_SECRET;
  const localEnv = parseEnvFile(join(REPO_ROOT, 'tests/e2e/local.env'));
  return localEnv.PAYMENT_WEBHOOK_SECRET || undefined;
}

/** Dựng cấu hình dùng chung cho các bước seed dữ liệu E2E qua HTTP API. */
export function createFlowConfig(): FlowConfig {
  return {
    api: new ApiClient(API_BASE_URL),
    otp: otpSourceFromEnv({
      ...process.env,
      E2E_OTP_LOG_FILE: process.env.E2E_OTP_LOG_FILE ?? join(E2E_RUN_DIR, 'api.log'),
    }),
    webhookSecret: webhookSecret(),
    paymentGateway: process.env.E2E_PAYMENT_GATEWAY ?? 'fake',
    eventTimeoutMs: Number(process.env.E2E_EVENT_TIMEOUT_MS ?? 60_000),
  };
}
