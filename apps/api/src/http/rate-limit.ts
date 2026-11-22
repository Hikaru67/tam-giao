import { domainError } from '@tamgiao/kernel';
import { problemResponse, type AppEnv } from '@tamgiao/http';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Redis } from 'ioredis';

/**
 * Rate limit tầng HTTP theo IP (BE-S7-07): một luật toàn cục + luật chặt hơn cho route nhạy cảm (OTP, đăng nhập,
 * xoá tài khoản, xuất dữ liệu). Đây là lớp chắn thô trước use case — luật nghiệp vụ theo số điện thoại/IP của OTP vẫn
 * nằm trong identity (`RateLimiter`). Cửa sổ cố định (fixed window) theo `windowSeconds`.
 */

/** Kết quả đếm một lượt trong cửa sổ hiện tại của `key`. */
export interface RateLimitHit {
  readonly count: number;
  /** Thời gian còn lại của cửa sổ (ms). */
  readonly resetInMs: number;
}

/** Nơi đếm số lượt theo key. Redis cho môi trường thật (đúng khi chạy nhiều instance), in-memory cho dev/test. */
export interface RateLimitStore {
  hit(key: string, windowSeconds: number): Promise<RateLimitHit>;
}

export interface RateLimitRule {
  /** Tên luật (gắn vào key Redis + log), `kebab-case`. */
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
  /** Route áp dụng: `"POST /auth/otp/request"`. Bỏ trống = mọi route (trừ `exemptPaths`). */
  readonly routes?: readonly string[];
}

export interface RateLimitOptions {
  readonly store: RateLimitStore;
  readonly rules: readonly RateLimitRule[];
  /** Path không bị luật toàn cục đếm (probe health/ready, scrape metrics). */
  readonly exemptPaths?: readonly string[];
  /** Tiền tố key (tách môi trường/ứng dụng dùng chung Redis). */
  readonly keyPrefix?: string;
}

const DEFAULT_EXEMPT_PATHS = ['/health', '/ready', '/metrics'];

/**
 * Middleware rate limit. Đặt sau `requestContext` (cần `clientIp`). Vượt bất kỳ luật nào → 429 `RATE_LIMITED`
 * kèm `Retry-After`. Store lỗi (Redis mất kết nối) → cho qua + log cảnh báo (fail-open): không để sự cố Redis làm sập
 * toàn bộ API; luật OTP nghiệp vụ ở identity (Postgres) vẫn chặn.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const exempt = new Set(options.exemptPaths ?? DEFAULT_EXEMPT_PATHS);
  const prefix = options.keyPrefix ?? 'rl';
  const rules = options.rules.map((rule) => ({ ...rule, routeSet: rule.routes && new Set(rule.routes) }));

  return createMiddleware<AppEnv>(async (c, next) => {
    const route = `${c.req.method} ${c.req.path}`;
    const matched = rules.filter((r) => (r.routeSet ? r.routeSet.has(route) : !exempt.has(c.req.path)));
    if (matched.length === 0) return next();

    const ip = c.get('clientIp');
    let retryAfterMs = 0;
    try {
      const hits = await Promise.all(
        matched.map(async (rule) => ({
          rule,
          hit: await options.store.hit(`${prefix}:${rule.name}:${ip}`, rule.windowSeconds),
        })),
      );
      for (const { rule, hit } of hits) {
        if (hit.count > rule.limit) retryAfterMs = Math.max(retryAfterMs, hit.resetInMs);
      }
    } catch (error) {
      c.get('logger').warn({ err: error }, 'rate limit store failed, allowing request');
      return next();
    }

    if (retryAfterMs > 0) {
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      c.header('retry-after', String(retryAfterSeconds));
      return problemResponse(c, domainError('RATE_LIMITED', { retryAfterSeconds }));
    }
    return next();
  });
}

/**
 * Store trong bộ nhớ tiến trình. **Giới hạn:** mỗi instance đếm riêng → chạy N instance thì giới hạn thực tế ≈ N lần;
 * mất khi restart. Chỉ dùng cho dev/test hoặc khi chưa có Redis.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly now: () => number = () => performance.timeOrigin + performance.now(),
    /** Dọn cửa sổ hết hạn khi số key vượt ngưỡng (tránh rò bộ nhớ khi bị quét nhiều IP). */
    private readonly sweepThreshold = 10_000,
  ) {}

  async hit(key: string, windowSeconds: number): Promise<RateLimitHit> {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      if (this.windows.size >= this.sweepThreshold) this.sweep(now);
      window = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.windows.set(key, window);
    }
    window.count += 1;
    return { count: window.count, resetInMs: window.resetAt - now };
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/** INCR + đặt hạn ở lượt đầu, trong một lệnh nguyên tử; trả `[count, pttl]`. */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/** Store dùng Redis (dùng chung giữa mọi instance API) — đếm đúng khi scale ngang. */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, windowSeconds: number): Promise<RateLimitHit> {
    const result = await this.redis.eval(HIT_SCRIPT, 1, key, String(windowSeconds * 1000));
    if (!Array.isArray(result) || typeof result[0] !== 'number' || typeof result[1] !== 'number') {
      throw new Error('rate limit: kết quả Redis không hợp lệ');
    }
    return { count: result[0], resetInMs: result[1] };
  }
}

/** Ngưỡng rate limit lấy từ config env (`RATE_LIMIT_*`) — không phải luật nghiệp vụ nên không nằm trong constants. */
export interface ApiRateLimitLimits {
  readonly globalPerMinute: number;
  readonly otpPerMinute: number;
  readonly loginPerMinute: number;
  readonly dataRightsPerHour: number;
}

/** Route nhạy cảm theo nhóm (BE-S7-07). Thêm route nhạy cảm mới → thêm vào đây. */
export const SENSITIVE_ROUTES = {
  otp: ['POST /auth/otp/request', 'POST /auth/otp/verify', 'POST /me/account/deletion/otp'],
  login: ['POST /admin/auth/login', 'POST /partner/auth/login'],
  dataRights: ['POST /me/data-exports', 'POST /me/account/deletion'],
} as const;

/** Bộ luật của API: toàn cục theo phút + từng nhóm route nhạy cảm. */
export function apiRateLimitRules(limits: ApiRateLimitLimits): readonly RateLimitRule[] {
  return [
    { name: 'global', limit: limits.globalPerMinute, windowSeconds: 60 },
    { name: 'otp', limit: limits.otpPerMinute, windowSeconds: 60, routes: SENSITIVE_ROUTES.otp },
    { name: 'login', limit: limits.loginPerMinute, windowSeconds: 60, routes: SENSITIVE_ROUTES.login },
    {
      name: 'data-rights',
      limit: limits.dataRightsPerHour,
      windowSeconds: 3_600,
      routes: SENSITIVE_ROUTES.dataRights,
    },
  ];
}
