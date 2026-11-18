import {
  envBoolean,
  envHttpUrl,
  envLogLevel,
  envNodeEnv,
  envPort,
  envPostgresUrl,
  loadEnvOrExit,
  parseEnv,
  type Env,
} from '@tamgiao/config';
import { z } from 'zod';

/** Khoá nhị phân truyền dạng base64, tối thiểu `minBytes` bytes. */
const envBase64Key = (minBytes: number) =>
  z
    .string()
    .transform((v) => Buffer.from(v, 'base64'))
    .refine((key) => key.length >= minBytes);

const apiEnvSchema = z
  .object({
    NODE_ENV: envNodeEnv.default('development'),
    LOG_LEVEL: envLogLevel.default('info'),
    API_PORT: envPort.default(3000),
    /** Danh sách origin cách nhau bởi dấu phẩy; bỏ trống = không bật CORS. */
    CORS_ORIGINS: z.string().optional(),
    API_BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
    /** Chỉ bật khi API đứng sau reverse proxy tin cậy (lấy IP client từ `x-forwarded-for`). */
    TRUST_PROXY: envBoolean.default(false),
    DATABASE_URL: envPostgresUrl,
    S3_ENDPOINT: envHttpUrl,
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string(),
    S3_SECRET_ACCESS_KEY: z.string(),
    S3_FORCE_PATH_STYLE: envBoolean.default(true),
    S3_BUCKET_PUBLIC_PROFILE: z.string().default('public-profile'),
    S3_BUCKET_PRIVATE_KYC: z.string().default('private-kyc'),
    /** Key ring mã hoá dữ liệu nhạy cảm: `"<version>:<base64 32 bytes>[,…]"` (xem `parseMasterKeyRing`). */
    DATA_MASTER_KEYS: z.string(),
    DATA_MASTER_KEY_VERSION: z.coerce.number().int().min(1).max(65_535).default(1),
    BLIND_INDEX_KEY: envBase64Key(32),
    /** Bí mật gốc của identity (băm OTP, ký access token…). */
    AUTH_SECRET: envBase64Key(32),
    SMS_PROVIDER: z.enum(['console']).default('console'),
    /** Nhà cung cấp eKYC (D2 chưa chốt): `fake` = `FakeEkycProvider`, bị cấm khi NODE_ENV=production. */
    EKYC_PROVIDER: z.enum(['fake']).default('fake'),
    /** Thời gian chờ tối đa mỗi lần gọi nhà cung cấp eKYC (ms). */
    EKYC_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
    /** Tổng số lần gọi tối đa (lần đầu + retry) khi gặp lỗi tạm thời (timeout, 5xx). */
    EKYC_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
    /** Chờ trước retry thứ n = `EKYC_BACKOFF_MS * n` (ms). */
    EKYC_BACKOFF_MS: z.coerce.number().int().min(0).max(10_000).default(500),
    /** Cổng thanh toán (D3 chưa chốt): `fake` = `FakePaymentGateway`, bị cấm khi NODE_ENV=production. */
    PAYMENT_GATEWAY: z.enum(['fake']).default('fake'),
    /** Bí mật xác thực chữ ký webhook của cổng thanh toán (≥ 16 ký tự). */
    PAYMENT_WEBHOOK_SECRET: z.string().min(16),
    /** URL cổng chuyển người dùng về sau khi thanh toán (deep link hoặc trang web của app). */
    PAYMENT_RETURN_URL: z.url().default('tamgiao://payments/return'),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && e.SMS_PROVIDER === 'console') {
      // ConsoleSmsSender in OTP ra stdout → không được chạy ở production (AGENTS.md mục 5).
      ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'console không dùng ở production' });
    }
    if (e.NODE_ENV === 'production' && e.EKYC_PROVIDER === 'fake') {
      // FakeEkycProvider luôn "đạt" → không được chạy ở production.
      ctx.addIssue({ code: 'custom', path: ['EKYC_PROVIDER'], message: 'fake không dùng ở production' });
    }
    if (e.NODE_ENV === 'production' && e.PAYMENT_GATEWAY === 'fake') {
      // FakePaymentGateway không thu tiền thật và có endpoint giả lập thanh toán → không được chạy ở production.
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_GATEWAY'], message: 'fake không dùng ở production' });
    }
  })
  .transform((e) => ({
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    port: e.API_PORT,
    http: {
      corsOrigins: (e.CORS_ORIGINS ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      bodyLimitBytes: e.API_BODY_LIMIT_BYTES,
      trustProxy: e.TRUST_PROXY,
    },
    database: { url: e.DATABASE_URL },
    storage: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      buckets: { publicProfile: e.S3_BUCKET_PUBLIC_PROFILE, privateKyc: e.S3_BUCKET_PRIVATE_KYC },
    },
    crypto: {
      masterKeys: e.DATA_MASTER_KEYS,
      masterKeyVersion: e.DATA_MASTER_KEY_VERSION,
      blindIndexKey: e.BLIND_INDEX_KEY,
    },
    auth: { secret: e.AUTH_SECRET },
    sms: { provider: e.SMS_PROVIDER },
    ekyc: {
      provider: e.EKYC_PROVIDER,
      timeoutMs: e.EKYC_TIMEOUT_MS,
      maxAttempts: e.EKYC_MAX_ATTEMPTS,
      backoffMs: e.EKYC_BACKOFF_MS,
    },
    payment: {
      gateway: e.PAYMENT_GATEWAY,
      webhookSecret: e.PAYMENT_WEBHOOK_SECRET,
      returnUrl: e.PAYMENT_RETURN_URL,
    },
  }));

export type ApiConfig = z.output<typeof apiEnvSchema>;

export const parseApiConfig = (env: Env): ApiConfig => parseEnv('api', apiEnvSchema, env);

export const loadApiConfig = (env: Env = process.env): ApiConfig => loadEnvOrExit('api', apiEnvSchema, env);
