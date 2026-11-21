import { DEFAULT_RETRY_POLICY, PgBossScheduler, deadLetterQueue, type RetryPolicy } from '@tamgiao/db';
import type { Scheduler } from '@tamgiao/kernel';
import { PgBoss } from 'pg-boss';

export interface ApiJobScheduler {
  readonly scheduler: Scheduler;
  stop(): Promise<void>;
}

export interface ApiJobSchedulerOptions {
  readonly connectionString: string;
  /** Hàng đợi API gửi job vào (vd `matching.expire-match`) — tạo sẵn để `send` không lỗi khi worker chưa chạy. */
  readonly queues: readonly string[];
  readonly retry?: RetryPolicy;
  readonly onError: (error: Error) => void;
}

/**
 * pg-boss phía API **chỉ để gửi job** trong transaction nghiệp vụ (`PgBossScheduler`): không đăng ký worker,
 * `supervise: false` (bảo trì/giám sát hàng đợi do worker chạy), `schedule: false` (không chạy cron). Vẫn để
 * `migrate` mặc định để API khởi động được trên DB mới (pg-boss tự khoá advisory khi migrate).
 *
 * Mỗi hàng đợi được tạo cùng cấu hình `ensureQueue` của worker (retry + dead-letter `<queue>.dead`); `createQueue` của
 * pg-boss là `ON CONFLICT DO NOTHING` nên worker gọi `ensureQueue` sau đó không đổi gì. Không gọi `ensureQueue` vì hàm
 * đó còn chạy worker ghi log dead-letter — việc của worker.
 */
export async function startApiJobScheduler(options: ApiJobSchedulerOptions): Promise<ApiJobScheduler> {
  const boss = new PgBoss({ connectionString: options.connectionString, supervise: false, schedule: false });
  boss.on('error', options.onError);
  await boss.start();
  const retry = options.retry ?? DEFAULT_RETRY_POLICY;
  for (const queue of options.queues) {
    const dead = deadLetterQueue(queue);
    await boss.createQueue(dead);
    await boss.createQueue(queue, { ...retry, deadLetter: dead });
  }
  return {
    scheduler: new PgBossScheduler(boss),
    stop: () => boss.stop({ graceful: false, timeout: 2_000 }),
  };
}
