import { ConfigError } from '@tamgiao/config';
import type { JobLogger } from '@tamgiao/db';
import { describe, expect, it } from 'vitest';
import { parseWorkerConfig } from '../../config.js';
import { runVoucherExpiry } from '../voucher-expiry.js';

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
};

class RecordingLogger implements JobLogger {
  lines: { level: string; obj: object; msg: string }[] = [];
  info(obj: object, msg: string): void {
    this.lines.push({ level: 'info', obj, msg });
  }
  warn(obj: object, msg: string): void {
    this.lines.push({ level: 'warn', obj, msg });
  }
  error(obj: object, msg: string): void {
    this.lines.push({ level: 'error', obj, msg });
  }
}

describe('runVoucherExpiry', () => {
  it('ghi log số đếm (không PII)', async () => {
    const logger = new RecordingLogger();
    await runVoucherExpiry({ execute: async () => ({ expired: 3, batches: 1 }) }, logger);
    expect(logger.lines).toEqual([
      {
        level: 'info',
        obj: { job: 'billing.voucher-expiry', expired: 3, batches: 1 },
        msg: 'voucher expiry finished',
      },
    ]);
  });

  it('lỗi hạ tầng → throw để pg-boss thử lại', async () => {
    const failing = {
      execute: async () => {
        throw new Error('db down');
      },
    };
    await expect(runVoucherExpiry(failing, new RecordingLogger())).rejects.toThrow('db down');
  });
});

describe('worker config — job hết hạn voucher', () => {
  it('mặc định mỗi 15 phút, giờ Việt Nam; cấu hình được', () => {
    expect(parseWorkerConfig(ENV).jobs.voucherExpiry).toEqual({
      cron: '*/15 * * * *',
      tz: 'Asia/Ho_Chi_Minh',
    });
    expect(
      parseWorkerConfig({ ...ENV, VOUCHER_EXPIRY_CRON: '0 * * * *', VOUCHER_EXPIRY_TZ: 'UTC' }).jobs
        .voucherExpiry,
    ).toEqual({ cron: '0 * * * *', tz: 'UTC' });
  });

  it('cron sai số trường → ConfigError', () => {
    expect(() => parseWorkerConfig({ ...ENV, VOUCHER_EXPIRY_CRON: '*/15 *' })).toThrow(ConfigError);
  });
});
