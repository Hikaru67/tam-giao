import type { BannedUserRegistry } from '../application/ports/banned-user-registry.js';
import {
  fail,
  ok,
  type BlindIndexer,
  type DomainEvent,
  type Result,
  type Tx,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { AdminSessionRepository, AdminUserRepository } from '../application/ports/admin-repositories.js';
import type {
  AuditLogCursor,
  AuditLogFilter,
  AuditLogRepository,
} from '../application/ports/audit-log-repository.js';
import type { PasswordHasher } from '../application/ports/password-hasher.js';
import type { TotpService } from '../application/ports/totp.js';
import type { OtpChallengeRepository } from '../application/ports/otp-challenge-repository.js';
import type { OtpSecrets } from '../application/ports/otp-secrets.js';
import type { RateLimitDecision, RateLimiter } from '../application/ports/rate-limiter.js';
import type { SmsMessage, SmsSender } from '../application/ports/sms-sender.js';
import type { SessionRepository } from '../application/ports/session-repository.js';
import type {
  AccessTokenClaims,
  AccessTokenError,
  AccessTokenService,
  RefreshTokenSecrets,
} from '../application/ports/token-services.js';
import type { UserRepository } from '../application/ports/user-repository.js';
import { AdminSession, type AdminSessionState } from '../domain/admin-session.js';
import { AuditEntry, type AuditEntryState } from '../domain/audit-entry.js';
import { AdminUser, type AdminEmail, type AdminUserId, type AdminUserState } from '../domain/admin-user.js';
import { OtpChallenge, type OtpChallengeState } from '../domain/otp-challenge.js';
import type { RateLimitRule } from '../domain/otp-policy.js';
import type { PhoneNumber } from '../domain/phone-number.js';
import {
  Session,
  type RefreshTokenId,
  type RefreshTokenRecord,
  type SessionId,
  type SessionState,
} from '../domain/session.js';
import { User, type UserId, type UserState } from '../domain/user.js';

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

/** `BannedUserRegistry` in-memory (BE-S6-06). */
export class InMemoryBannedUserRegistry implements BannedUserRegistry {
  readonly table = new MemoryTable<Date>();

  async markBanned(_tx: Tx, userId: string, bannedAt: Date): Promise<void> {
    if (!this.table.rows.has(userId)) this.table.rows.set(userId, bannedAt);
  }

  async isBanned(_tx: Tx, userId: string): Promise<boolean> {
    return this.table.rows.has(userId);
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly table = new MemoryTable<SessionState>();
  readonly tokens = new MemoryTable<RefreshTokenRecord>();

  async findById(_tx: Tx, id: SessionId): Promise<Session | null> {
    const state = this.table.rows.get(id);
    return state ? Session.restore(state) : null;
  }

  async listActiveByUser(_tx: Tx, userId: UserId): Promise<Session[]> {
    return [...this.table.rows.values()]
      .filter((s) => s.userId === userId && s.revokedAt === null)
      .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
      .map((s) => Session.restore(s));
  }

  async save(_tx: Tx, session: Session): Promise<void> {
    this.table.rows.set(session.id, session.toState());
  }

  async findRefreshTokenForUpdate(_tx: Tx, tokenHash: string): Promise<RefreshTokenRecord | null> {
    return [...this.tokens.rows.values()].find((t) => t.tokenHash === tokenHash) ?? null;
  }

  async addRefreshToken(_tx: Tx, token: RefreshTokenRecord): Promise<void> {
    this.tokens.rows.set(token.id, token);
  }

  async markRefreshTokenUsed(_tx: Tx, id: RefreshTokenId, usedAt: Date): Promise<void> {
    const token = this.tokens.rows.get(id);
    if (token) this.tokens.rows.set(id, { ...token, usedAt });
  }
}

/** Token dạng `at|<userId>|<sessionId>|<expMs>` — đủ để test hạn dùng mà không cần ký thật. */
export class FakeAccessTokenService implements AccessTokenService {
  issue(claims: AccessTokenClaims, now: Date, ttlSeconds: number): string {
    return `at|${claims.userId}|${claims.sessionId}|${now.getTime() + ttlSeconds * 1_000}`;
  }

  verify(token: string, now: Date): Result<AccessTokenClaims, AccessTokenError> {
    const [prefix, userId, sessionId, exp] = token.split('|');
    if (prefix !== 'at' || !userId || !sessionId || !exp) return fail('UNAUTHENTICATED');
    if (now.getTime() >= Number(exp)) return fail('TOKEN_EXPIRED');
    return ok({ userId, sessionId });
  }
}

export class FakeRefreshTokenSecrets implements RefreshTokenSecrets {
  private counter = 0;
  generate(): string {
    return `refresh-token-${String(this.counter++).padStart(8, '0')}`;
  }
  hash(token: string): string {
    return `sha(${token})`;
  }
}

export class InMemoryAdminUserRepository implements AdminUserRepository {
  readonly table = new MemoryTable<AdminUserState>();

  async findByEmailForUpdate(_tx: Tx, email: AdminEmail): Promise<AdminUser | null> {
    const state = [...this.table.rows.values()].find((a) => a.email.equals(email));
    return state ? AdminUser.restore(state) : null;
  }

  async findById(_tx: Tx, id: AdminUserId): Promise<AdminUser | null> {
    const state = this.table.rows.get(id);
    return state ? AdminUser.restore(state) : null;
  }

  async insert(_tx: Tx, admin: AdminUser): Promise<boolean> {
    const state = admin.toState();
    if ([...this.table.rows.values()].some((a) => a.email.equals(state.email))) return false;
    this.table.rows.set(state.id, state);
    return true;
  }

  async update(_tx: Tx, admin: AdminUser): Promise<void> {
    this.table.rows.set(admin.id, admin.toState());
  }
}

export class InMemoryAdminSessionRepository implements AdminSessionRepository {
  readonly table = new MemoryTable<AdminSessionState>();

  async findByTokenHash(_tx: Tx, tokenHash: string): Promise<AdminSession | null> {
    const state = [...this.table.rows.values()].find((s) => s.tokenHash === tokenHash);
    return state ? AdminSession.restore(state) : null;
  }

  async save(_tx: Tx, session: AdminSession): Promise<void> {
    this.table.rows.set(session.id, session.toState());
  }
}

export class FakePasswordHasher implements PasswordHasher {
  dummyChecks = 0;
  async hash(password: string): Promise<string> {
    return `hashed(${password})`;
  }
  async verify(hash: string | null, password: string): Promise<boolean> {
    if (hash === null) {
      this.dummyChecks++;
      return false;
    }
    return hash === `hashed(${password})`;
  }
}

/** Mã TOTP đúng của bước `s` là `String(s % 1_000_000).padStart(6, '0')` — test tự tính được mã. */
export class FakeTotp implements TotpService {
  static codeAt(now: Date): string {
    return String(Math.floor(now.getTime() / 30_000) % 1_000_000).padStart(6, '0');
  }
  generateSecret(): string {
    return 'JBSWY3DPEHPK3PXP';
  }
  verify(_secret: string, code: string, now: Date): number | null {
    const step = Math.floor(now.getTime() / 30_000);
    for (const s of [step - 1, step, step + 1]) {
      if (String(s % 1_000_000).padStart(6, '0') === code) return s;
    }
    return null;
  }
  otpauthUri(secret: string, account: string): string {
    return `otpauth://totp/TamGiao:${account}?secret=${secret}`;
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly table = new MemoryTable<AuditEntryState>();

  async append(_tx: Tx, entry: AuditEntry): Promise<void> {
    const state = entry.toState();
    if (this.table.rows.has(state.id)) throw new Error('audit_logs: trùng id');
    this.table.rows.set(state.id, state);
  }

  async search(
    _tx: Tx,
    f: AuditLogFilter,
    cursor: AuditLogCursor | null,
    limit: number,
  ): Promise<AuditEntry[]> {
    const key = (s: { occurredAt: Date; id: string }) => `${s.occurredAt.toISOString()}|${s.id}`;
    return [...this.table.rows.values()]
      .filter(
        (s) =>
          (f.actorType === undefined || s.actor.type === f.actorType) &&
          (f.actorId === undefined || s.actor.id === f.actorId) &&
          (f.action === undefined || s.action === f.action) &&
          (f.targetType === undefined || s.targetType === f.targetType) &&
          (f.targetId === undefined || s.targetId === f.targetId) &&
          (f.from === undefined || s.occurredAt >= f.from) &&
          (f.to === undefined || s.occurredAt < f.to) &&
          (cursor === null || key(s) < key(cursor)),
      )
      .sort((a, b) => (key(a) < key(b) ? 1 : -1))
      .slice(0, limit)
      .map((s) => AuditEntry.restore(s));
  }
}
