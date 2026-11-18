import { ensureQueue, type JobLogger, type RetryPolicy } from '@tamgiao/db';
import type { KycMediaPurgeSummary } from '@tamgiao/module-verification';
import type { PgBoss } from 'pg-boss';

/** Hàng đợi job xoá ảnh eKYC theo thời hạn lưu (BE-S3-06). */
export const KYC_MEDIA_RETENTION_QUEUE = 'verification.kyc-media-retention';

/** Lỗi một phần (storage/DB) → pg-boss chạy lại cả lượt; an toàn vì use case idempotent. */
const RETRY: RetryPolicy = { retryLimit: 3, retryDelay: 300, retryBackoff: true };

export interface KycMediaPurger {
  execute(): Promise<KycMediaPurgeSummary>;
}

/**
 * Một lượt chạy: gọi use case, ghi log **chỉ số đếm + id hồ sơ** (không key ảnh, không PII).
 * Có hồ sơ lỗi → throw để pg-boss thử lại theo `RETRY` (hết lượt → dead-letter, có log lỗi).
 */
export async function runKycMediaRetention(purge: KycMediaPurger, logger: JobLogger): Promise<void> {
  const summary = await purge.execute();
  const failed = summary.failedIds.length;
  logger.info(
    { job: KYC_MEDIA_RETENTION_QUEUE, purged: summary.purged, skipped: summary.skipped, failed },
    'kyc media retention finished',
  );
  if (failed > 0) {
    logger.warn(
      { job: KYC_MEDIA_RETENTION_QUEUE, submissionIds: summary.failedIds },
      'kyc media retention failed for some submissions',
    );
    throw new Error(`kyc media retention: ${failed} submission(s) failed`);
  }
}

/**
 * Đăng ký job hằng ngày: tạo hàng đợi (+ dead-letter), lịch cron (pg-boss `schedule`, idempotent theo tên
 * hàng đợi — nhiều worker cùng đăng ký vẫn chỉ một lịch) và worker xử lý từng job một.
 */
export async function registerKycMediaRetentionJob(options: {
  readonly boss: PgBoss;
  readonly logger: JobLogger;
  readonly purge: KycMediaPurger;
  /** Biểu thức cron (5 trường), vd `0 3 * * *`. */
  readonly cron: string;
  /** Múi giờ IANA của biểu thức cron, vd `Asia/Ho_Chi_Minh`. */
  readonly tz: string;
}): Promise<void> {
  const { boss, logger, purge } = options;
  await ensureQueue(boss, KYC_MEDIA_RETENTION_QUEUE, RETRY, logger);
  await boss.schedule(KYC_MEDIA_RETENTION_QUEUE, options.cron, null, { tz: options.tz });
  await boss.work(KYC_MEDIA_RETENTION_QUEUE, { batchSize: 1 }, async () => {
    await runKycMediaRetention(purge, logger);
  });
}
