import type { DomainEvent, Tx, UnitOfWork } from '@tamgiao/kernel';
import { ok } from '@tamgiao/kernel';
import type { JobResult, PgBoss } from 'pg-boss';
import { asPgClient } from '../tx.js';
import {
  DEFAULT_RETRY_POLICY,
  ensureQueue,
  jobIdFor,
  pgBossDb,
  type JobLogger,
  type RetryPolicy,
} from '../jobs/pg-boss.js';
import { consumerQueue, type EventBus, type Subscription } from './event-bus.js';

/** Dạng event khi đi qua pg-boss (Date → chuỗi ISO). */
interface SerializedEvent extends Omit<DomainEvent, 'occurredAt'> {
  readonly occurredAt: string;
}

interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  payload: unknown;
  occurred_at: Date;
}

const toSerialized = (row: OutboxRow): SerializedEvent => ({
  eventId: row.id,
  type: row.event_type,
  aggregateType: row.aggregate_type,
  aggregateId: row.aggregate_id,
  version: row.aggregate_version,
  occurredAt: row.occurred_at.toISOString(),
  payload: row.payload,
});

const fromSerialized = (e: SerializedEvent): DomainEvent => ({ ...e, occurredAt: new Date(e.occurredAt) });

/** Số job một consumer lấy mỗi lần (BE-S7-09) — đủ để xả backlog nhanh mà một lô vẫn ngắn. */
const CONSUMER_BATCH_SIZE = 20;

/**
 * Đọc outbox và chuyển event thành job cho từng consumer.
 * - `FOR UPDATE SKIP LOCKED`: nhiều relay chạy song song không lấy trùng event.
 * - Job ghi cùng transaction với việc đánh dấu `published_at`; id job = f(consumer, eventId) nên
 *   có chạy lại cũng không sinh job trùng.
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly deps: {
      uow: UnitOfWork;
      boss: PgBoss;
      bus: EventBus;
      logger: JobLogger;
      batchSize?: number;
    },
  ) {}

  /** Phát một lô event; trả về số event đã xử lý. */
  async publishBatch(): Promise<number> {
    const { uow, boss, bus } = this.deps;
    const result = await uow.run(async (tx) => {
      const client = asPgClient(tx);
      const { rows } = await client.query<OutboxRow>(
        `select id, event_type, aggregate_type, aggregate_id, aggregate_version, payload, occurred_at
           from platform.outbox
          where published_at is null
          order by created_at, id
          limit $1
          for update skip locked`,
        [this.deps.batchSize ?? 100],
      );
      for (const row of rows) {
        const event = toSerialized(row);
        for (const sub of bus.consumersOf(row.event_type)) {
          await boss.send(
            consumerQueue(sub.consumer),
            { event },
            {
              id: jobIdFor(`${sub.consumer}:${event.eventId}`),
              db: pgBossDb(client),
            },
          );
        }
      }
      if (rows.length > 0) {
        await client.query(`update platform.outbox set published_at = now() where id = any($1::uuid[])`, [
          rows.map((r) => r.id),
        ]);
      }
      return ok(rows.length);
    });
    return result.unwrapOr(0);
  }

  /** Chạy định kỳ; không bao giờ chồng 2 lượt lên nhau trong cùng tiến trình. */
  start(intervalMs = 1_000): void {
    const tick = async () => {
      try {
        let published: number;
        do {
          published = await this.publishBatch();
        } while (published === (this.deps.batchSize ?? 100));
      } catch (error) {
        this.deps.logger.error({ err: error }, 'outbox relay failed');
      } finally {
        if (this.running !== undefined) this.timer = setTimeout(() => (this.running = tick()), intervalMs);
      }
    };
    this.running = tick();
  }

  async stop(): Promise<void> {
    const current = this.running;
    this.running = undefined;
    if (this.timer) clearTimeout(this.timer);
    await current;
  }
}

/**
 * Xử lý event cho một consumer **đúng một lần**: ghi `processed_events` trong cùng transaction với handler.
 * Đã xử lý rồi → bỏ qua; handler throw → rollback cả dấu `processed_events` để lần thử lại chạy lại.
 */
export async function deliverOnce(uow: UnitOfWork, sub: Subscription, event: DomainEvent): Promise<boolean> {
  const result = await uow.run(async (tx: Tx) => {
    const inserted = await asPgClient(tx).query(
      `insert into platform.processed_events (consumer, event_id) values ($1, $2) on conflict do nothing`,
      [sub.consumer, event.eventId],
    );
    if (inserted.rowCount === 0) return ok(false);
    await sub.handler(event, tx);
    return ok(true);
  });
  return result.unwrapOr(false);
}

/** Tạo hàng đợi + worker cho mọi consumer đã đăng ký trên `bus`. Gọi khi worker khởi động, trước `relay.start()`. */
export async function registerConsumers(options: {
  boss: PgBoss;
  uow: UnitOfWork;
  bus: EventBus;
  logger: JobLogger;
  retry?: RetryPolicy;
  pollingIntervalSeconds?: number;
}): Promise<void> {
  const { boss, uow, bus, logger } = options;
  const polling = options.pollingIntervalSeconds ?? 2;
  for (const sub of bus.list()) {
    const queue = consumerQueue(sub.consumer);
    await ensureQueue(boss, queue, options.retry ?? DEFAULT_RETRY_POLICY, logger, polling);
    await boss.work<{ event: SerializedEvent }>(
      queue,
      // pg-boss luôn chờ đủ `polling` giữa hai lần lấy job: với `batchSize: 1` mỗi consumer chỉ ~0,5 event/s
      // (BE-S7-09: k6 chat 46 tin/s dồn hàng đợi notification, p95 xử lý 175 s). Lấy lô `CONSUMER_BATCH_SIZE` và
      // `burstWhenBatchFull` (lô đầy → lấy tiếp ngay, không chờ nhịp). `perJobResults`: kết quả theo từng job — một event
      // lỗi chỉ làm job đó thử lại / dead-letter, không kéo theo các event khác trong lô. Event xử lý tuần tự trong lô.
      {
        pollingIntervalSeconds: polling,
        batchSize: CONSUMER_BATCH_SIZE,
        burstWhenBatchFull: true,
        perJobResults: true,
      },
      async (jobs) => {
        const results: JobResult[] = [];
        for (const job of jobs) {
          try {
            await deliverOnce(uow, sub, fromSerialized(job.data.event));
            results.push({ id: job.id, status: 'completed' });
          } catch (error) {
            logger.warn(
              { consumer: sub.consumer, eventId: job.data.event.eventId, err: error },
              'event handler failed',
            );
            results.push({
              id: job.id,
              status: 'failed',
              output: { message: error instanceof Error ? error.message : String(error) },
            });
          }
        }
        return results;
      },
    );
  }
}
