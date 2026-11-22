import { ensureQueue, type JobLogger, type RetryPolicy } from '@tamgiao/db';
import type { PgBoss } from 'pg-boss';

/** Hàng đợi job xoá nội dung file xuất dữ liệu quá hạn tải (BE-S7-06). */
export const DATA_EXPORT_PURGE_QUEUE = 'identity.data-export-purge';

/** Mỗi 30 phút: file quá hạn 24 giờ bị xoá nội dung chậm nhất 30 phút sau hạn. */
export const DATA_EXPORT_PURGE_CRON = '*/30 * * * *';

const RETRY: RetryPolicy = { retryLimit: 3, retryDelay: 60, retryBackoff: true };

export interface DataExportPurger {
  execute(): Promise<number>;
}

export async function runDataExportPurge(purger: DataExportPurger, logger: JobLogger): Promise<void> {
  const purged = await purger.execute();
  logger.info({ job: DATA_EXPORT_PURGE_QUEUE, purged }, 'data export purge finished');
}

/** Đăng ký job định kỳ: hàng đợi (+ dead-letter), lịch cron (idempotent theo tên hàng đợi), worker. */
export async function registerDataExportPurgeJob(options: {
  readonly boss: PgBoss;
  readonly logger: JobLogger;
  readonly purger: DataExportPurger;
  readonly tz?: string;
}): Promise<void> {
  const { boss, logger, purger } = options;
  await ensureQueue(boss, DATA_EXPORT_PURGE_QUEUE, RETRY, logger);
  await boss.schedule(DATA_EXPORT_PURGE_QUEUE, DATA_EXPORT_PURGE_CRON, null, {
    tz: options.tz ?? 'Asia/Ho_Chi_Minh',
  });
  await boss.work(DATA_EXPORT_PURGE_QUEUE, { batchSize: 1 }, async () => {
    await runDataExportPurge(purger, logger);
  });
}
