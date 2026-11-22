import { ensureQueue, type JobLogger, type RetryPolicy } from '@tamgiao/db';
import { NOTIFICATION_SEND_QUEUE, type SendNotificationOutcome } from '@tamgiao/module-notification';
import type { PgBoss } from 'pg-boss';

export interface NotificationSender {
  execute(deliveryId: string): Promise<SendNotificationOutcome>;
}

/**
 * Lỗi push tạm thời / Expo lỗi mạng → throw, pg-boss thử lại backoff (≈ 10s × 2ⁿ, 6 lần ≈ 10 phút); hết lượt →
 * dead-letter (log error), thông báo giữ `PENDING`.
 */
export const NOTIFICATION_SEND_RETRY: RetryPolicy = { retryLimit: 6, retryDelay: 10, retryBackoff: true };

/** Payload `{deliveryId}` do consumer notification hẹn. Sai dạng → lỗi lập trình (throw → retry → dead-letter). */
export function parseNotificationSendPayload(payload: Readonly<Record<string, unknown>>): string {
  const { deliveryId } = payload;
  if (typeof deliveryId !== 'string' || deliveryId.length === 0) {
    throw new Error(`${NOTIFICATION_SEND_QUEUE}: payload thiếu deliveryId`);
  }
  return deliveryId;
}

/**
 * Chạy một job gửi thông báo, log kết quả (chỉ id + loại kết quả, không PII / nội dung). `NOT_DUE` (job chạy sớm hơn
 * `send_after`, vd lệch đồng hồ) → throw để thử lại sau.
 */
export async function runNotificationSend(
  sender: NotificationSender,
  payload: Readonly<Record<string, unknown>>,
  logger: JobLogger,
): Promise<SendNotificationOutcome> {
  const deliveryId = parseNotificationSendPayload(payload);
  const outcome = await sender.execute(deliveryId);
  if (outcome.kind === 'NOT_DUE') {
    throw new Error(`${NOTIFICATION_SEND_QUEUE} ${deliveryId}: chưa tới giờ gửi`);
  }
  if (outcome.kind === 'NOT_FOUND') {
    logger.warn({ job: NOTIFICATION_SEND_QUEUE, deliveryId }, 'notification not found, job skipped');
  } else {
    logger.info({ job: NOTIFICATION_SEND_QUEUE, deliveryId, ...outcome }, 'notification handled');
  }
  return outcome;
}

/**
 * Đăng ký worker hàng đợi `notification.send` (BE-S7-05). Không bọc transaction ở đây: use case tự mở 2 transaction
 * ngắn và gọi nhà cung cấp push ở giữa. Phải đăng ký **trước** khi relay outbox chạy (consumer hẹn job vào hàng đợi này).
 */
export async function registerNotificationSendJob(options: {
  readonly boss: PgBoss;
  readonly logger: JobLogger;
  readonly sender: NotificationSender;
  readonly retry?: RetryPolicy;
  readonly pollingIntervalSeconds?: number;
}): Promise<void> {
  const { boss, logger, sender } = options;
  const polling = options.pollingIntervalSeconds ?? 2;
  await ensureQueue(boss, NOTIFICATION_SEND_QUEUE, options.retry ?? NOTIFICATION_SEND_RETRY, logger, polling);
  await boss.work<Record<string, unknown>>(
    NOTIFICATION_SEND_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: polling },
    async (jobs) => {
      for (const job of jobs) await runNotificationSend(sender, job.data, logger);
    },
  );
}
