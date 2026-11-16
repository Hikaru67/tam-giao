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

const apiEnvSchema = z
  .object({
    NODE_ENV: envNodeEnv.default('development'),
    LOG_LEVEL: envLogLevel.default('info'),
    API_PORT: envPort.default(3000),
    /** Danh sách origin cách nhau bởi dấu phẩy; bỏ trống = không bật CORS. */
    CORS_ORIGINS: z.string().optional(),
    API_BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
    DATABASE_URL: envPostgresUrl,
    S3_ENDPOINT: envHttpUrl,
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string(),
    S3_SECRET_ACCESS_KEY: z.string(),
    S3_FORCE_PATH_STYLE: envBoolean.default(true),
    S3_BUCKET_PUBLIC_PROFILE: z.string().default('public-profile'),
    S3_BUCKET_PRIVATE_KYC: z.string().default('private-kyc'),
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
  }));

export type ApiConfig = z.output<typeof apiEnvSchema>;

export const parseApiConfig = (env: Env): ApiConfig => parseEnv('api', apiEnvSchema, env);

export const loadApiConfig = (env: Env = process.env): ApiConfig => loadEnvOrExit('api', apiEnvSchema, env);
