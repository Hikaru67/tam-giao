import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { OutboxBacklog, QueueDepth } from './backlog.js';

/**
 * Metric Prometheus cơ bản của API (BE-S7-08): độ trễ + lỗi HTTP, độ dài hàng đợi pg-boss, outbox chưa publish.
 * Nhãn chỉ gồm method / route mẫu (`/me/match/:id`, không phải URL thật) / status — không chứa id hay PII.
 */
export interface ApiMetricsSources {
  readonly outboxBacklog?: () => Promise<OutboxBacklog>;
  readonly queueDepths?: () => Promise<QueueDepth[]>;
  /** Lỗi khi đọc nguồn lúc scrape (không làm hỏng cả trang metric). */
  readonly onCollectError?: (source: string, error: unknown) => void;
}

export interface ApiMetrics {
  readonly registry: Registry;
  readonly middleware: MiddlewareHandler;
}

export function createApiMetrics(
  sources: ApiMetricsSources = {},
  options: { defaultMetrics?: boolean } = {},
): ApiMetrics {
  const registry = new Registry();
  if (options.defaultMetrics ?? true) collectDefaultMetrics({ register: registry });

  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Độ trễ request HTTP theo route mẫu',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.3, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  const serverErrors = new Counter({
    name: 'http_server_errors_total',
    help: 'Số response 5xx theo route mẫu',
    labelNames: ['method', 'route'] as const,
    registers: [registry],
  });

  const report = (source: string, error: unknown) => sources.onCollectError?.(source, error);

  if (sources.outboxBacklog) {
    const read = sources.outboxBacklog;
    let last: Promise<OutboxBacklog | undefined> | undefined;
    // Hai gauge dùng chung một lần đọc mỗi lượt scrape.
    const snapshot = () =>
      (last ??= read()
        .catch((error: unknown) => {
          report('outbox', error);
          return undefined;
        })
        .finally(() => setImmediate(() => (last = undefined))));
    new Gauge({
      name: 'outbox_unpublished_events',
      help: 'Số domain event trong outbox chưa được relay',
      registers: [registry],
      async collect() {
        const s = await snapshot();
        if (s) this.set(s.unpublished);
      },
    });
    new Gauge({
      name: 'outbox_oldest_unpublished_age_seconds',
      help: 'Tuổi (giây) của event chưa relay lâu nhất',
      registers: [registry],
      async collect() {
        const s = await snapshot();
        if (s) this.set(s.oldestAgeSeconds);
      },
    });
  }

  if (sources.queueDepths) {
    const read = sources.queueDepths;
    new Gauge({
      name: 'job_queue_depth',
      help: 'Số job pg-boss đang chờ/chạy theo hàng đợi và trạng thái',
      labelNames: ['queue', 'state'] as const,
      registers: [registry],
      async collect() {
        try {
          const depths = await read();
          this.reset();
          for (const d of depths) this.set({ queue: d.queue, state: d.state }, d.count);
        } catch (error) {
          report('queues', error);
        }
      },
    });
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    const start = performance.now();
    try {
      await next();
    } finally {
      // Route mẫu của handler cuối cùng khớp; chỉ khớp middleware `*` (404) → gom chung một nhãn.
      const matched = routePath(c, -1);
      const route = matched === '*' || matched === '/*' ? 'unmatched' : matched;
      const status = c.res.status;
      duration.observe(
        { method: c.req.method, route, status: String(status) },
        (performance.now() - start) / 1000,
      );
      if (status >= 500) serverErrors.inc({ method: c.req.method, route });
    }
  };

  return { registry, middleware };
}
