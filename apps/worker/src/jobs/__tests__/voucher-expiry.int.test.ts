import type { JobLogger } from '@tamgiao/db';
import { testDatabaseUrl } from '@tamgiao/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerVoucherExpiryJob, VOUCHER_EXPIRY_QUEUE } from '../voucher-expiry.js';

const silent: JobLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('registerVoucherExpiryJob (pg-boss)', () => {
  let boss: PgBoss;
  let runs = 0;
  const expirer = {
    execute: async () => {
      runs++;
      return { expired: 0, batches: 1 };
    },
  };

  beforeAll(async () => {
    // `schedule: false`: không để cron pass tự gửi job trong lúc test; lịch vẫn được lưu.
    boss = new PgBoss({ connectionString: testDatabaseUrl(), schedule: false });
    boss.on('error', () => undefined);
    await boss.start();
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, timeout: 2_000 });
  });

  it('lưu lịch cron cấu hình được và worker chạy use case khi có job', async () => {
    await registerVoucherExpiryJob({ boss, logger: silent, expirer, cron: '*/10 * * * *', tz: 'UTC' });

    const schedule = await boss.getSchedule(VOUCHER_EXPIRY_QUEUE);
    expect(schedule).toMatchObject({ name: VOUCHER_EXPIRY_QUEUE, cron: '*/10 * * * *' });
    expect(schedule?.timezone).toBe('UTC');

    await boss.send(VOUCHER_EXPIRY_QUEUE, {});
    const deadline = Date.now() + 15_000;
    while (runs === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    expect(runs).toBe(1);
  });
});
