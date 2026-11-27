import type { AdminCredentials, FlowConfig } from '../../../../tests/e2e/src/lib/flow.js';
import { ApiClient } from '../../../../tests/e2e/src/lib/http.js';
import { otpSourceFromEnv } from '../../../../tests/e2e/src/lib/otp.js';

/** Cấu hình cho server helper e2e mobile (FE-S6-01). */
export interface HelperConfig {
  readonly baseUrl: string;
  readonly port: number;
  readonly flow: FlowConfig;
  readonly admin: AdminCredentials;
  readonly dateLeadSeconds: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`thiếu biến môi trường ${name}`);
  return value;
}

function positiveNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`biến môi trường ${name} phải là số dương`);
  }
  return parsed;
}

/** Đọc cấu hình helper từ biến môi trường; thiếu biến bắt buộc hoặc số không hợp lệ → throw. */
export function loadHelperConfig(env: NodeJS.ProcessEnv): HelperConfig {
  const baseUrl = env.E2E_BASE_URL || 'http://localhost:3100';
  const port = positiveNumber(env, 'E2E_HELPER_PORT', 3199);
  if (!Number.isInteger(port) || port > 65535) {
    throw new Error('biến môi trường E2E_HELPER_PORT không hợp lệ');
  }
  const eventTimeoutMs = positiveNumber(env, 'E2E_EVENT_TIMEOUT_MS', 60_000);
  const dateLeadSeconds = positiveNumber(env, 'E2E_DATE_LEAD_SECONDS', 90);
  const webhookSecret = env.E2E_WEBHOOK_SECRET || undefined;

  return {
    baseUrl,
    port,
    flow: {
      api: new ApiClient(baseUrl),
      otp: otpSourceFromEnv(env),
      webhookSecret,
      paymentGateway: env.E2E_PAYMENT_GATEWAY || 'fake',
      eventTimeoutMs,
    },
    admin: {
      email: required(env, 'E2E_ADMIN_EMAIL'),
      password: required(env, 'E2E_ADMIN_PASSWORD'),
      totpSecret: required(env, 'E2E_ADMIN_TOTP_SECRET'),
    },
    dateLeadSeconds,
  };
}
