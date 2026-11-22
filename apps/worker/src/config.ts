import {
  envBoolean,
  envHttpUrl,
  envLogLevel,
  envNodeEnv,
  envPostgresUrl,
  loadEnvOrExit,
  parseEnv,
  type Env,
} from '@tamgiao/config';
import { z } from 'zod';

/** Khoá nhị phân truyền dạng base64, tối thiểu `minBytes` bytes (giống `apps/api/src/config.ts`). */
const envBase64Key = (minBytes: number) =>
  z
    .string()
    .transform((v) => Buffer.from(v, 'base64'))
    .refine((key) => key.length >= minBytes);

/** Cron 5 trường (phút giờ ngày tháng thứ) — pg-boss kiểm tra cú pháp chi tiết khi `schedule`. */
const envCron = z.string().regex(/^\S+(\s+\S+){4}$/, 'cron 5 trường, vd "0 3 * * *"');

const workerEnvSchema = z
  .object({
    NODE_ENV: envNodeEnv.default('development'),
    LOG_LEVEL: envLogLevel.default('info'),
    DATABASE_URL: envPostgresUrl,
    // Object storage — job xoá ảnh eKYC (BE-S3-06).
    S3_ENDPOINT: envHttpUrl,
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string(),
    S3_SECRET_ACCESS_KEY: z.string(),
    S3_FORCE_PATH_STYLE: envBoolean.default(true),
    S3_BUCKET_PUBLIC_PROFILE: z.string().default('public-profile'),
    S3_BUCKET_PRIVATE_KYC: z.string().default('private-kyc'),
    // Khoá dữ liệu + bí mật identity: composition root của identity cần để dựng `auditLogger` (BE-S3-06).
    DATA_MASTER_KEYS: z.string(),
    DATA_MASTER_KEY_VERSION: z.coerce.number().int().min(1).max(65_535).default(1),
    BLIND_INDEX_KEY: envBase64Key(32),
    AUTH_SECRET: envBase64Key(32),
    /** Lịch job xoá ảnh eKYC hết thời hạn lưu (mặc định 03:00 hằng ngày). */
    KYC_MEDIA_RETENTION_CRON: envCron.default('0 3 * * *'),
    KYC_MEDIA_RETENTION_TZ: z.string().min(1).default('Asia/Ho_Chi_Minh'),
    /** Lịch job chuyển voucher quá hạn sang EXPIRED (mặc định mỗi 15 phút — BE-S4-05). */
    VOUCHER_EXPIRY_CRON: envCron.default('*/15 * * * *'),
    VOUCHER_EXPIRY_TZ: z.string().min(1).default('Asia/Ho_Chi_Minh'),
    /** Lịch job đối soát ledger (mặc định 02:30 hằng ngày giờ VN — BE-S4-07). */
    LEDGER_RECONCILIATION_CRON: envCron.default('30 2 * * *'),
    LEDGER_RECONCILIATION_TZ: z.string().min(1).default('Asia/Ho_Chi_Minh'),
    /** Cổng thanh toán cho job hoàn tiền (BE-S4-04) — D3 chưa chốt, hiện chỉ `fake`, bị cấm ở production. */
    PAYMENT_GATEWAY: z.enum(['fake']).default('fake'),
    /** Secret của cổng (fake: ký webhook) — dùng chung giá trị với API. */
    PAYMENT_WEBHOOK_SECRET: z.string().min(16),
    /** Kênh push (BE-S7-05): `expo` = Expo Push API; `fake` = chỉ ghi nhận trong bộ nhớ, bị cấm ở production. */
    PUSH_PROVIDER: z.enum(['expo', 'fake']).default('fake'),
    /** Access token Expo ("Enhanced push security") — tuỳ chọn. */
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
    // Observability (BE-S7-08)
    /** DSN Sentry; bỏ trống = không gửi lỗi đi đâu (no-op). */
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: z.string().min(1).optional(),
    /** Phiên bản đang chạy (git sha) — image Docker gán sẵn qua build arg. */
    APP_RELEASE: z.string().min(1).optional(),
    /** Cảnh báo khi số event outbox chưa relay lớn hơn ngưỡng này. */
    OUTBOX_BACKLOG_MAX_EVENTS: z.coerce.number().int().min(1).default(500),
    /** Cảnh báo khi event chưa relay cũ nhất quá số giây này. */
    OUTBOX_BACKLOG_MAX_AGE_SECONDS: z.coerce.number().int().min(10).default(300),
    OUTBOX_BACKLOG_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3_600).default(60),
    /** Đang tồn đọng thì nhắc lại sau bao nhiêu phút. */
    OUTBOX_BACKLOG_REALERT_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && e.PAYMENT_GATEWAY === 'fake') {
      // FakePaymentGateway không hoàn tiền thật → không được chạy ở production.
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_GATEWAY'], message: 'fake không dùng ở production' });
    }
    if (e.NODE_ENV === 'production' && e.PUSH_PROVIDER === 'fake') {
      ctx.addIssue({ code: 'custom', path: ['PUSH_PROVIDER'], message: 'fake không dùng ở production' });
    }
  })
  .transform((e) => ({
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
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
    jobs: {
      kycMediaRetention: { cron: e.KYC_MEDIA_RETENTION_CRON, tz: e.KYC_MEDIA_RETENTION_TZ },
      voucherExpiry: { cron: e.VOUCHER_EXPIRY_CRON, tz: e.VOUCHER_EXPIRY_TZ },
      ledgerReconciliation: { cron: e.LEDGER_RECONCILIATION_CRON, tz: e.LEDGER_RECONCILIATION_TZ },
    },
    payment: { gateway: e.PAYMENT_GATEWAY, webhookSecret: e.PAYMENT_WEBHOOK_SECRET },
    push: { provider: e.PUSH_PROVIDER, expoAccessToken: e.EXPO_ACCESS_TOKEN },
    observability: {
      sentry: { dsn: e.SENTRY_DSN, environment: e.SENTRY_ENVIRONMENT ?? e.NODE_ENV, release: e.APP_RELEASE },
      outboxBacklog: {
        thresholds: {
          maxUnpublished: e.OUTBOX_BACKLOG_MAX_EVENTS,
          maxAgeSeconds: e.OUTBOX_BACKLOG_MAX_AGE_SECONDS,
        },
        checkIntervalMs: e.OUTBOX_BACKLOG_CHECK_INTERVAL_SECONDS * 1_000,
        realertAfterMs: e.OUTBOX_BACKLOG_REALERT_MINUTES * 60_000,
      },
    },
  }));

export type WorkerConfig = z.output<typeof workerEnvSchema>;

export const parseWorkerConfig = (env: Env): WorkerConfig => parseEnv('worker', workerEnvSchema, env);

export const loadWorkerConfig = (env: Env = process.env): WorkerConfig =>
  loadEnvOrExit('worker', workerEnvSchema, env);
