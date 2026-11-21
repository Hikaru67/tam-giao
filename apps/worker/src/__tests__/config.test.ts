import { ConfigError } from '@tamgiao/config';
import { describe, expect, it } from 'vitest';
import { parseWorkerConfig } from '../config.js';

const KEY = Buffer.alloc(32, 1).toString('base64');
const ENV = {
  DATABASE_URL: 'postgres://tamgiao@localhost:5433/tamgiao',
  NODE_ENV: 'test',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_ACCESS_KEY_ID: 'tamgiao',
  S3_SECRET_ACCESS_KEY: 'secret',
  DATA_MASTER_KEYS: `1:${KEY}`,
  BLIND_INDEX_KEY: KEY,
  AUTH_SECRET: KEY,
  PAYMENT_WEBHOOK_SECRET: 'worker-test-payment-secret',
};

describe('worker config', () => {
  it('env hợp lệ → map đúng cấu trúc, lịch job mặc định 03:00 giờ Việt Nam', () => {
    const config = parseWorkerConfig(ENV);
    expect(config).toMatchObject({
      nodeEnv: 'test',
      logLevel: 'info',
      database: { url: 'postgres://tamgiao@localhost:5433/tamgiao' },
      storage: {
        endpoint: 'http://localhost:8333',
        region: 'us-east-1',
        forcePathStyle: true,
        buckets: { publicProfile: 'public-profile', privateKyc: 'private-kyc' },
      },
      crypto: { masterKeys: `1:${KEY}`, masterKeyVersion: 1 },
      jobs: { kycMediaRetention: { cron: '0 3 * * *', tz: 'Asia/Ho_Chi_Minh' } },
    });
    expect(config.auth.secret).toHaveLength(32);
  });

  it('lịch job xoá ảnh eKYC cấu hình được', () => {
    const config = parseWorkerConfig({
      ...ENV,
      KYC_MEDIA_RETENTION_CRON: '30 2 * * *',
      KYC_MEDIA_RETENTION_TZ: 'UTC',
    });
    expect(config.jobs.kycMediaRetention).toEqual({ cron: '30 2 * * *', tz: 'UTC' });
  });

  it('cron sai số trường → ConfigError', () => {
    expect(() => parseWorkerConfig({ ...ENV, KYC_MEDIA_RETENTION_CRON: '0 3 *' })).toThrow(ConfigError);
  });

  it('cổng thanh toán cho job hoàn tiền (BE-S4-04): mặc định fake; fake bị cấm ở production', () => {
    expect(parseWorkerConfig(ENV).payment).toEqual({
      gateway: 'fake',
      webhookSecret: 'worker-test-payment-secret',
    });
    expect(() => parseWorkerConfig({ ...ENV, NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(() => parseWorkerConfig({ ...ENV, PAYMENT_WEBHOOK_SECRET: 'short' })).toThrow(ConfigError);
  });

  it('thiếu DATABASE_URL → ConfigError', () => {
    expect(() => parseWorkerConfig({})).toThrow(ConfigError);
  });
});
