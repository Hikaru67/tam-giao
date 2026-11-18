import { fail, newId, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { AdminSession } from '../../domain/admin-session.js';
import { AdminEmail } from '../../domain/admin-user.js';
import { ROLE_PERMISSIONS, type AdminPermission, type AdminRole } from '../../domain/permissions.js';
import type { AdminSessionRepository, AdminUserRepository } from '../ports/admin-repositories.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { TotpService } from '../ports/totp.js';
import type { RefreshTokenSecrets } from '../ports/token-services.js';

export interface AdminLoginCommand {
  readonly email: string;
  readonly password: string;
  readonly totpCode?: string | undefined;
  readonly rememberDevice?: boolean | undefined;
}

export interface AdminLoginResult {
  readonly token: string;
  readonly expiresAt: Date;
  readonly admin: {
    readonly id: string;
    readonly email: string;
    readonly role: AdminRole;
    readonly permissions: readonly AdminPermission[];
  };
}

export type AdminLoginError = DomainError<'INVALID_CREDENTIALS' | 'MFA_REQUIRED' | 'ADMIN_LOCKED'>;

export interface AdminLoginDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly admins: AdminUserRepository;
  readonly sessions: AdminSessionRepository;
  readonly passwords: PasswordHasher;
  readonly totp: TotpService;
  /** Sinh token phiên ngẫu nhiên + hash để lưu (dùng chung kiểu với refresh token người dùng app). */
  readonly tokens: RefreshTokenSecrets;
}

/** Đăng nhập admin: bắt buộc đủ mật khẩu + TOTP; thành công → mở phiên ngắn (8h / 12h nếu ghi nhớ thiết bị). */
export class AdminLogin {
  constructor(private readonly deps: AdminLoginDeps) {}

  async execute(cmd: AdminLoginCommand): Promise<Result<AdminLoginResult, AdminLoginError>> {
    // Thiếu mã TOTP → báo ngay, không kiểm tra mật khẩu (không thành "máy dò" mật khẩu khi chưa có mã 2FA).
    if (!cmd.totpCode) return fail('MFA_REQUIRED');
    const totpCode = cmd.totpCode;
    const { uow, clock, admins, sessions, passwords, totp, tokens } = this.deps;
    const email = AdminEmail.parse(cmd.email);
    if (email.isErr()) {
      await passwords.verify(null, cmd.password);
      return fail('INVALID_CREDENTIALS');
    }
    const now = clock.now();

    // Lần sai phải được commit dù kết quả là lỗi → transaction trả `ok(<kết quả nghiệp vụ>)`.
    const committed = await uow.run<Result<AdminLoginResult, AdminLoginError>, never>(async (tx) => {
      const admin = await admins.findByEmailForUpdate(tx, email.value);
      if (!admin) {
        await passwords.verify(null, cmd.password);
        return ok(fail('INVALID_CREDENTIALS'));
      }
      const locked = admin.lockRemainingSeconds(now);
      if (locked > 0) return ok(fail('ADMIN_LOCKED', { retryAfterSeconds: locked }));

      const result = admin.login(
        {
          passwordMatches: await passwords.verify(admin.passwordHash, cmd.password),
          totpStep: totp.verify(admin.totpSecret, totpCode, now),
        },
        now,
      );
      await admins.update(tx, admin);
      if (result.isErr()) return ok(fail(result.error.code, result.error.details));

      const token = tokens.generate();
      const session = AdminSession.start(
        {
          id: newId<'AdminSession'>(),
          adminId: admin.id,
          tokenHash: tokens.hash(token),
          rememberDevice: cmd.rememberDevice ?? false,
        },
        now,
      );
      await sessions.save(tx, session);
      return ok(
        ok({
          token,
          expiresAt: session.expiresAt,
          admin: {
            id: admin.id,
            email: admin.email.value,
            role: admin.role,
            permissions: ROLE_PERMISSIONS[admin.role],
          },
        }),
      );
    });
    if (committed.isErr()) throw new Error('unreachable: transaction AdminLogin không trả Err');
    return committed.value;
  }
}
