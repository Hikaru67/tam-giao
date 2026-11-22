import { createLogger } from '@tamgiao/config';
import type { AppEnv } from '@tamgiao/http';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createApiMetrics, type ApiMetricsSources } from '../metrics.js';

function setup(sources: ApiMetricsSources = {}, metricsToken?: string) {
  const routes = new Hono<AppEnv>();
  routes.get('/test/items/:id', (c) => c.json({ id: c.req.param('id') }));
  routes.get('/test/boom', () => {
    throw new Error('boom');
  });
  const metrics = createApiMetrics(sources, { defaultMetrics: false });
  const app = createApp({
    logger: createLogger({ service: 'api', level: 'fatal', destination: { write: () => undefined } }),
    modules: [{ name: 'test', routes }],
    readinessChecks: [],
    corsOrigins: [],
    bodyLimitBytes: 1_048_576,
    observability: { metrics, metricsToken },
  });
  const scrape = async (headers: Record<string, string> = {}) => {
    const res = await app.request('/metrics', { headers });
    return { res, text: await res.text() };
  };
  return { app, scrape };
}

describe('API metrics (Prometheus)', () => {
  it('độ trễ HTTP theo route mẫu (không phải URL thật) + method + status; 404 gom nhãn "unmatched"', async () => {
    const { app, scrape } = setup();
    await app.request('/test/items/0190a3f2-secret-id');
    await app.request('/test/items/another');
    await app.request('/no/such/route');

    const { res, text } = await scrape();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/test/items/:id",status="200"} 2',
    );
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="unmatched",status="404"} 1',
    );
    expect(text).not.toContain('0190a3f2-secret-id');
  });

  it('lỗi 5xx → http_server_errors_total tăng', async () => {
    const { app, scrape } = setup();
    expect((await app.request('/test/boom')).status).toBe(500);
    const { text } = await scrape();
    expect(text).toContain('http_server_errors_total{method="GET",route="/test/boom"} 1');
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/test/boom",status="500"} 1',
    );
  });

  it('gauge outbox chưa publish + tuổi event cũ nhất + độ dài hàng đợi (đọc lúc scrape)', async () => {
    let outboxReads = 0;
    const { scrape } = setup({
      outboxBacklog: async () => {
        outboxReads++;
        return { unpublished: 42, oldestAgeSeconds: 125.5 };
      },
      queueDepths: async () => [
        { queue: 'matching.expire-match', state: 'created', count: 3 },
        { queue: 'consumer.billing', state: 'active', count: 1 },
      ],
    });
    const { text } = await scrape();
    expect(text).toContain('outbox_unpublished_events 42');
    expect(text).toContain('outbox_oldest_unpublished_age_seconds 125.5');
    expect(text).toContain('job_queue_depth{queue="matching.expire-match",state="created"} 3');
    expect(text).toContain('job_queue_depth{queue="consumer.billing",state="active"} 1');
    // Hai gauge outbox dùng chung một lần đọc DB mỗi lượt scrape.
    expect(outboxReads).toBe(1);
  });

  it('nguồn lỗi lúc scrape → vẫn trả 200 các metric khác, báo onCollectError', async () => {
    const errors: string[] = [];
    const { app, scrape } = setup({
      outboxBacklog: () => Promise.reject(new Error('db down')),
      queueDepths: () => Promise.reject(new Error('db down')),
      onCollectError: (source) => errors.push(source),
    });
    await app.request('/test/items/1');
    const { res, text } = await scrape();
    expect(res.status).toBe(200);
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/test/items/:id",status="200"} 1',
    );
    expect(errors.sort()).toEqual(['outbox', 'queues']);
  });

  it('METRICS_TOKEN → thiếu/sai bearer 401, đúng bearer 200', async () => {
    const token = 'metrics-token-0123456789';
    const { scrape } = setup({}, token);
    expect((await scrape()).res.status).toBe(401);
    expect((await scrape({ authorization: 'Bearer wrong' })).res.status).toBe(401);
    expect((await scrape({ authorization: `Bearer ${token}` })).res.status).toBe(200);
  });

  it('không cấu hình metrics → không có /metrics', async () => {
    const app = createApp({
      logger: createLogger({ service: 'api', level: 'fatal', destination: { write: () => undefined } }),
      modules: [],
      readinessChecks: [],
      corsOrigins: [],
      bodyLimitBytes: 1_048_576,
    });
    expect((await app.request('/metrics')).status).toBe(404);
    expect((await app.request('/openapi.json')).status).toBe(404);
  });
});
