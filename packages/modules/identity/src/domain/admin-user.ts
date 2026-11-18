import { Entity, addDuration, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';
import type { AdminRole } from './permissions.js';

export type AdminUserId = Id<'AdminUser'>;

/** Sai mật khẩu/TOTP liên tiếp tới ngưỡng này thì khoá tài khoản (BE-S2-03 AC3). */
export const ADMIN_MAX_FAILED_LOGINS = 5;
export const ADMIN_LOCK_MINUTES = 15;
/** Mật khẩu admin tối thiểu 12 ký tự. */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

export type AdminLoginError = DomainError<'INVALID_CREDENTIALS' | 'ADMIN_LOCKED'>;

/** Email công vụ của admin, chuẩn hoá chữ thường. */
export class AdminEmail {
  private constructor(readonly value: string) {}

  static parse(input: string): Result<AdminEmail, DomainError<'VALIDATION_FAILED'>> {
    const value = input.trim().toLowerCase();
    if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return fail('VALIDATION_FAILED');
    return ok(new AdminEmail(value));
  }

  equals(other: AdminEmail): boolean {
    return other.value === this.value;
  }
}

export interface AdminUserState {
  readonly id: AdminUserId;
  readonly email: AdminEmail;
  /** Hash argon2id (chuỗi PHC) — domain không biết thuật toán. */
  readonly passwordHash: string;
  /** Secret TOTP base32 (infrastructure mã hoá khi lưu). */
  readonly totpSecret: string;
  readonly role: AdminRole;
  readonly failedLogins: number;
  readonly lockedUntil: Date | null;
  /** Bước TOTP của lần đăng nhập thành công gần nhất — mã cùng bước hoặc cũ hơn bị từ chối (chống dùng lại). */
  readonly lastTotpStep: number | null;
  readonly createdAt: Date;
}

/** Kết quả kiểm tra thông tin đăng nhập do application tính (qua port `PasswordHasher`, `TotpService`). */
export interface LoginCheck {
  readonly passwordMatches: boolean;
  /** Bước thời gian mà mã TOTP khớp, hoặc `null` nếu sai. */
  readonly totpStep: number | null;
}

/**
 * Tài khoản cán bộ quản trị. Đăng nhập bắt buộc đủ mật khẩu + TOTP; sai một trong hai đều tính là một lần sai
 * và trả cùng lỗi `INVALID_CREDENTIALS` (không cho biết phần nào sai).
 */
export class AdminUser extends Entity<AdminUserId> {
  private constructor(private state: AdminUserState) {
    super(state.id);
  }

  static create(
    input: Pick<AdminUserState, 'id' | 'email' | 'passwordHash' | 'totpSecret' | 'role'>,
    now: Date,
  ): AdminUser {
    return new AdminUser({
      ...input,
      failedLogins: 0,
      lockedUntil: null,
      lastTotpStep: null,
      createdAt: now,
    });
  }

  static restore(state: AdminUserState): AdminUser {
    return new AdminUser(state);
  }

  get email(): AdminEmail {
    return this.state.email;
  }
  get role(): AdminRole {
    return this.state.role;
  }
  get passwordHash(): string {
    return this.state.passwordHash;
  }
  get totpSecret(): string {
    return this.state.totpSecret;
  }

  /** Số giây còn bị khoá (0 nếu không khoá) — use case kiểm tra trước để khỏi tốn công băm mật khẩu. */
  lockRemainingSeconds(now: Date): number {
    const until = this.state.lockedUntil;
    if (!until || until.getTime() <= now.getTime()) return 0;
    return Math.ceil((until.getTime() - now.getTime()) / 1_000);
  }

  /**
   * Ghi nhận một lần đăng nhập. `Err` vẫn có thể đổi state (đếm lần sai / khoá) → use case phải lưu.
   * Lần sai thứ `ADMIN_MAX_FAILED_LOGINS` khoá `ADMIN_LOCK_MINUTES` phút; hết khoá thì đếm lại từ 0.
   */
  login(check: LoginCheck, now: Date): Result<void, AdminLoginError> {
    const locked = this.lockRemainingSeconds(now);
    if (locked > 0) return fail('ADMIN_LOCKED', { retryAfterSeconds: locked });

    const replayed =
      check.totpStep !== null &&
      this.state.lastTotpStep !== null &&
      check.totpStep <= this.state.lastTotpStep;
    if (!check.passwordMatches || check.totpStep === null || replayed) {
      const failedLogins = this.state.failedLogins + 1;
      if (failedLogins >= ADMIN_MAX_FAILED_LOGINS) {
        const lockedUntil = addDuration(now, { minutes: ADMIN_LOCK_MINUTES });
        this.state = { ...this.state, failedLogins: 0, lockedUntil };
        return fail('ADMIN_LOCKED', { retryAfterSeconds: ADMIN_LOCK_MINUTES * 60 });
      }
      this.state = { ...this.state, failedLogins, lockedUntil: null };
      return fail('INVALID_CREDENTIALS');
    }

    this.state = { ...this.state, failedLogins: 0, lockedUntil: null, lastTotpStep: check.totpStep };
    return ok();
  }

  toState(): AdminUserState {
    return this.state;
  }
}
