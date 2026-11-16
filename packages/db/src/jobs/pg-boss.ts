import type { ScheduledJob, Scheduler, Tx, UnitOfWork } from '@tamgiao/kernel';
import { ok } from '@tamgiao/kernel';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { v5 as uuidv5 } from 'uuid';
import { asPgClient } from '../tx.js';

/** Namespace cố định để sinh id job xác định từ khoá (UUID v5). Không được đổi sau khi lên production. */
const JOB_ID_NAMESPACE = '6c0e3a1e-2b4f-5d7a-9e8c-1f2a3b4c5d6e';

/** Id job xác định từ khoá: gửi cùng khoá 2 lần → pg-boss bỏ qua lần 2 (`ON CONFLICT DO NOTHING`). */
export const jobIdFor = (key: string): string => uuidv5(key, JOB_ID_NAMESPACE);

/** Cho pg-boss chạy SQL trên connection của transaction hiện tại (ghi job cùng transaction với dữ liệu). */
export const pgBossDb = (client: pg.PoolClient) => ({
  executeSql: async (text: string, values?: unknown[]) => ({ rows: (await client.query(text, values)).rows }),
});

/** Logger tối thiểu (tương thích pino) cho hạ tầng job. */
export interface JobLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface RetryPolicy {
  /** Số lần thử lại trước khi chuyển dead-letter. */
  readonly retryLimit: number;
  /** Giây chờ trước lần thử lại đầu tiên (nhân đôi mỗi lần nếu `retryBackoff`). */
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { retryLimit: 5, retryDelay: 5, retryBackoff: true };

export const deadLetterQueue = (queue: string): string => `${queue}.dead`;

/**
 * Tạo hàng đợi + hàng đợi dead-letter (idempotent). Job thất bại hết số lần thử được chuyển sang
 * `<queue>.dead`, nơi có worker ghi log lỗi để vận hành xử lý — không chặn các job khác.
 */
export async function ensureQueue(
  boss: PgBoss,
  queue: string,
  retry: RetryPolicy,
  logger: JobLogger,
  pollingIntervalSeconds = 2,
): Promise<void> {
  const dead = deadLetterQueue(queue);
  await boss.createQueue(dead);
  await boss.createQueue(queue, { ...retry, deadLetter: dead });
  await boss.work<Record<string, unknown>>(dead, { pollingIntervalSeconds }, async (jobs) => {
    for (const job of jobs) {
      logger.error({ queue, jobId: job.id, data: job.data }, 'job moved to dead-letter');
    }
  });
}

/** `Scheduler` trên pg-boss: job ghi cùng transaction, id xác định từ `queue:key` để chống trùng. */
export class PgBossScheduler implements Scheduler {
  constructor(private readonly boss: PgBoss) {}

  async schedule(tx: Tx, job: ScheduledJob): Promise<void> {
    await this.boss.send(
      job.queue,
      { ...job.payload },
      {
        id: jobIdFor(`${job.queue}:${job.key}`),
        startAfter: job.runAt,
        db: pgBossDb(asPgClient(tx)),
      },
    );
  }
}

export type JobHandler = (payload: Readonly<Record<string, unknown>>, tx: Tx) => Promise<void>;

/**
 * Đăng ký worker cho một hàng đợi job hẹn giờ. Handler chạy trong transaction của `uow`;
 * throw → rollback và pg-boss thử lại theo `retry`. Handler phải tự kiểm tra lại trạng thái (idempotent).
 */
export async function registerJob(options: {
  boss: PgBoss;
  uow: UnitOfWork;
  logger: JobLogger;
  queue: string;
  handler: JobHandler;
  retry?: RetryPolicy;
  pollingIntervalSeconds?: number;
}): Promise<void> {
  const { boss, uow, logger, queue, handler } = options;
  const polling = options.pollingIntervalSeconds ?? 2;
  await ensureQueue(boss, queue, options.retry ?? DEFAULT_RETRY_POLICY, logger, polling);
  await boss.work<Record<string, unknown>>(
    queue,
    { pollingIntervalSeconds: polling, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await uow.run(async (tx) => {
          await handler(job.data, tx);
          return ok();
        });
      }
    },
  );
}
