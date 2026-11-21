import { ensureQueue, type JobLogger, type RetryPolicy } from '@tamgiao/db';
import type { VoucherExpirySummary } from '@tamgiao/module-billing';
import type { PgBoss } from 'pg-boss';

/** Hàng đợi job chuyển voucher quá hạn sang `EXPIRED` (BE-S4-05). */
export const VOUCHER_EXPIRY_QUEUE = 'billing.voucher-expiry';

/** Lỗi DB → pg-boss chạy lại cả lượt; an toàn vì use case idempotent (voucher đã `EXPIRED` không bị chọn lại). */
const RETRY: RetryPolicy = { retryLimit: 3, retryDelay: 60, retryBackoff: true };

export interface VoucherExpirer {
  execute(): Promise<VoucherExpirySummary>;
}

/** Một lượt chạy: gọi use case, ghi log chỉ số đếm (không PII). Lỗi hạ tầng throw lên để pg-boss thử lại. */
export async function runVoucherExpiry(expirer: VoucherExpirer, logger: JobLogger): Promise<void> {
  const summary = await expirer.execute();
  logger.info(
    { job: VOUCHER_EXPIRY_QUEUE, expired: summary.expired, batches: summary.batches },
    'voucher expiry finished',
  );
}

/**
 * Đăng ký job định kỳ: tạo hàng đợi (+ dead-letter), lịch cron (pg-boss `schedule`, idempotent theo tên hàng đợi)
 * và worker xử lý từng job một.
 */
export async function registerVoucherExpiryJob(options: {
  readonly boss: PgBoss;
  readonly logger: JobLogger;
  readonly expirer: VoucherExpirer;
  /** Biểu thức cron (5 trường), vd `*\/15 * * * *`. */
  readonly cron: string;
  /** Múi giờ IANA của biểu thức cron, vd `Asia/Ho_Chi_Minh`. */
  readonly tz: string;
}): Promise<void> {
  const { boss, logger, expirer } = options;
  await ensureQueue(boss, VOUCHER_EXPIRY_QUEUE, RETRY, logger);
  await boss.schedule(VOUCHER_EXPIRY_QUEUE, options.cron, null, { tz: options.tz });
  await boss.work(VOUCHER_EXPIRY_QUEUE, { batchSize: 1 }, async () => {
    await runVoucherExpiry(expirer, logger);
  });
}
