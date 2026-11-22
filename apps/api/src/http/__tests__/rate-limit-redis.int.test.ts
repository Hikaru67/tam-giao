import { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisRateLimitStore } from '../rate-limit.js';

/** BE-S7-07 — store rate limit trên Redis thật (Testcontainers): đếm nguyên tử, hết hạn theo cửa sổ, dùng chung. */
let container: StartedTestContainer;
let redis: Redis;

beforeAll(async () => {
  container = await new GenericContainer('redis:7.4-alpine').withExposedPorts(6379).start();
  redis = new Redis(`redis://${container.getHost()}:${container.getMappedPort(6379)}`);
});
afterAll(async () => {
  await redis?.quit();
  await container?.stop();
});

describe('RedisRateLimitStore', () => {
  it('đếm tăng dần trong cửa sổ, TTL đặt ở lượt đầu và không bị kéo dài', async () => {
    const store = new RedisRateLimitStore(redis);
    const first = await store.hit('rl:test:a', 60);
    expect(first.count).toBe(1);
    expect(first.resetInMs).toBeGreaterThan(59_000);
    const second = await store.hit('rl:test:a', 60);
    expect(second.count).toBe(2);
    expect(second.resetInMs).toBeLessThanOrEqual(first.resetInMs);
  });

  it('hết cửa sổ → đếm lại từ 1', async () => {
    const store = new RedisRateLimitStore(redis);
    await store.hit('rl:test:short', 1);
    await redis.pexpire('rl:test:short', 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await store.hit('rl:test:short', 1)).count).toBe(1);
  });

  it('nhiều instance (client) đồng thời dùng chung bộ đếm, không mất lượt', async () => {
    const other = redis.duplicate();
    try {
      const stores = [new RedisRateLimitStore(redis), new RedisRateLimitStore(other)];
      const hits = await Promise.all(
        Array.from({ length: 50 }, (_, i) => stores[i % 2]!.hit('rl:test:shared', 60)),
      );
      expect(hits.map((h) => h.count).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 50 }, (_, i) => i + 1),
      );
    } finally {
      await other.quit();
    }
  });
});
