import type { Tx } from '@tamgiao/kernel';
import type { RateLimitRule } from '../../domain/otp-policy.js';

export type RateLimitDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface RateLimiter {
  /**
   * Nếu `key` còn trong mọi giới hạn → ghi nhận 1 lượt (trong `tx`) và cho phép; ngược lại từ chối kèm thời gian chờ.
   * Hai lời gọi đồng thời cùng `key` phải được xử lý tuần tự (không cùng lọt qua giới hạn).
   * `key` không được chứa PII thô — dùng blind index.
   */
  consume(tx: Tx, key: string, rules: readonly RateLimitRule[], now: Date): Promise<RateLimitDecision>;
}
