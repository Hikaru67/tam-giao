import type { JobLogger } from '@tamgiao/db';
import type { KycMediaPurgeSummary } from '@tamgiao/module-verification';
import { testDatabaseUrl } from '@tamgiao/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KYC_MEDIA_RETENTION_QUEUE, registerKycMediaRetentionJob } from '../kyc-media-retention.js';

const silent: JobLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('registerKycMediaRetentionJob (pg-boss)', () => {
  let boss: PgBoss;
  let runs = 0;
  const purge = {
    execute: async (): Promise<KycMediaPurgeSummary> => {
      runs++;
      return { purged: 0, skipped: 0, failedIds: [] };
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

  it('lưu lịch cron cấu hình được và worker chạy use case khi có job; đăng ký lại không tạo lịch trùng', async () => {
    const options = { boss, logger: silent, purge, cron: '15 4 * * *', tz: 'Asia/Ho_Chi_Minh' };
    await registerKycMediaRetentionJob(options);

    const schedule = await boss.getSchedule(KYC_MEDIA_RETENTION_QUEUE);
    expect(schedule).toMatchObject({ name: KYC_MEDIA_RETENTION_QUEUE, cron: '15 4 * * *' });
    expect(schedule?.timezone).toBe('Asia/Ho_Chi_Minh');

    await boss.send(KYC_MEDIA_RETENTION_QUEUE, {});
    const deadline = Date.now() + 15_000;
    while (runs === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    expect(runs).toBe(1);

    await boss.schedule(KYC_MEDIA_RETENTION_QUEUE, '15 4 * * *', null, { tz: 'Asia/Ho_Chi_Minh' });
    expect(await boss.getSchedules(KYC_MEDIA_RETENTION_QUEUE)).toHaveLength(1);
  });
});
