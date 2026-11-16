import type { BlindIndexer, DomainEvent, Result, Tx, UnitOfWork } from '@tamgiao/kernel';
import type { OtpChallengeRepository } from '../application/ports/otp-challenge-repository.js';
import type { OtpSecrets } from '../application/ports/otp-secrets.js';
import type { RateLimitDecision, RateLimiter } from '../application/ports/rate-limiter.js';
import type { SmsMessage, SmsSender } from '../application/ports/sms-sender.js';
import type { UserRepository } from '../application/ports/user-repository.js';
import { OtpChallenge, type OtpChallengeState } from '../domain/otp-challenge.js';
import type { RateLimitRule } from '../domain/otp-policy.js';
import type { PhoneNumber } from '../domain/phone-number.js';
import { User, type UserState } from '../domain/user.js';

/** Kho in-memory có thể chụp/khôi phục để `FakeUnitOfWork` giả lập rollback. */
export class MemoryTable<T> {
  rows = new Map<string, T>();
  snapshot(): Map<string, T> {
    return new Map(this.rows);
  }
  restore(snapshot: Map<string, T>): void {
    this.rows = new Map(snapshot);
  }
}

/** Giữ đúng hợp đồng port: `Err` hoặc throw → khôi phục mọi bảng đã đăng ký. */
export class FakeUnitOfWork implements UnitOfWork {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bảng chứa kiểu dòng bất kỳ
  constructor(private readonly tables: readonly MemoryTable<any>[]) {}

  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const snapshots = this.tables.map((t) => t.snapshot());
    const rollback = () => this.tables.forEach((t, i) => t.restore(snapshots[i] ?? new Map()));
    try {
      const result = await work({} as Tx);
      if (result.isErr()) rollback();
      return result;
    } catch (error) {
      rollback();
      throw error;
    }
  }
}

export class InMemoryOtpChallengeRepository implements OtpChallengeRepository {
  readonly table = new MemoryTable<OtpChallengeState>();

  async findByPhoneForUpdate(_tx: Tx, phoneIndex: string): Promise<OtpChallenge | null> {
    const state = this.table.rows.get(phoneIndex);
    return state ? OtpChallenge.restore(state) : null;
  }

  async save(_tx: Tx, challenge: OtpChallenge): Promise<void> {
    const state = challenge.toState();
    this.table.rows.set(state.phoneIndex, state);
  }
}

export class InMemoryUserRepository implements UserRepository {
  readonly table = new MemoryTable<UserState>();
  readonly events = new MemoryTable<DomainEvent>();

  async findByPhone(_tx: Tx, phone: PhoneNumber): Promise<User | null> {
    const state = [...this.table.rows.values()].find((u) => u.phone.equals(phone));
    return state ? User.restore(state) : null;
  }

  async save(_tx: Tx, user: User): Promise<void> {
    for (const event of user.pullEvents()) this.events.rows.set(event.eventId, event);
    this.table.rows.set(user.id, {
      id: user.id,
      phone: user.phone,
      createdAt: user.createdAt,
      version: user.version,
    });
  }
}

export class InMemoryRateLimiter implements RateLimiter {
  readonly table = new MemoryTable<readonly Date[]>();

  async consume(
    _tx: Tx,
    key: string,
    rules: readonly RateLimitRule[],
    now: Date,
  ): Promise<RateLimitDecision> {
    const hits = [...(this.table.rows.get(key) ?? [])].sort((a, b) => b.getTime() - a.getTime());
    let retryAt = 0;
    for (const rule of rules) {
      const windowMs = rule.windowSeconds * 1_000;
      const blocking = hits.filter((h) => h.getTime() > now.getTime() - windowMs)[rule.limit - 1];
      if (blocking) retryAt = Math.max(retryAt, blocking.getTime() + windowMs);
    }
    if (retryAt > 0) {
      return { allowed: false, retryAfterSeconds: Math.ceil((retryAt - now.getTime()) / 1_000) };
    }
    this.table.rows.set(key, [...hits, now]);
    return { allowed: true };
  }
}

/** Sinh mã theo hàng đợi cho trước (mặc định `000000`, `000001`, …) để test biết trước OTP. */
export class FakeOtpSecrets implements OtpSecrets {
  private counter = 0;
  constructor(private readonly queue: string[] = []) {}

  generate(): string {
    return this.queue.shift() ?? String(this.counter++).padStart(6, '0');
  }
  hash(code: string, salt: string): string {
    return `hash(${salt}:${code})`;
  }
  matches(code: string, salt: string, hash: string): boolean {
    return this.hash(code, salt) === hash;
  }
}

export class RecordingSmsSender implements SmsSender {
  readonly sent: SmsMessage[] = [];
  failNext = false;

  async send(message: SmsMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('sms gateway down');
    }
    this.sent.push(message);
  }

  /** Mã OTP trong SMS gần nhất. */
  lastCode(): string {
    const code = /\b(\d{6})\b/.exec(this.sent.at(-1)?.text ?? '')?.[1];
    if (!code) throw new Error('chưa có SMS OTP nào');
    return code;
  }
}

export class FakeBlindIndexer implements BlindIndexer {
  index(value: string, purpose: string): string {
    return `${purpose}|${value}`;
  }
}
