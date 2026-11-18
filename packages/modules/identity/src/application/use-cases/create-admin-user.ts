import { fail, newId, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { ADMIN_PASSWORD_MIN_LENGTH, AdminEmail, AdminUser } from '../../domain/admin-user.js';
import { isAdminRole } from '../../domain/permissions.js';
import type { AdminUserRepository } from '../ports/admin-repositories.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { TotpService } from '../ports/totp.js';

export interface CreateAdminUserCommand {
  readonly email: string;
  readonly password: string;
  readonly role: string;
}

export interface CreateAdminUserResult {
  readonly adminId: string;
  /** Hiển thị **một lần** cho người được cấp tài khoản để thêm vào app Authenticator. */
  readonly otpauthUri: string;
}

export type CreateAdminUserError = DomainError<
  'VALIDATION_FAILED' | 'PASSWORD_TOO_WEAK' | 'ADMIN_EMAIL_TAKEN'
>;

export interface CreateAdminUserDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly admins: AdminUserRepository;
  readonly passwords: PasswordHasher;
  readonly totp: TotpService;
}

/** Tạo tài khoản admin kèm secret TOTP mới. Hiện dùng cho CLI seed admin đầu tiên (`tools/seed-admin.ts`). */
export class CreateAdminUser {
  constructor(private readonly deps: CreateAdminUserDeps) {}

  async execute(cmd: CreateAdminUserCommand): Promise<Result<CreateAdminUserResult, CreateAdminUserError>> {
    const email = AdminEmail.parse(cmd.email);
    if (email.isErr()) return fail('VALIDATION_FAILED', { field: 'email' });
    if (!isAdminRole(cmd.role)) return fail('VALIDATION_FAILED', { field: 'role' });
    if (cmd.password.length < ADMIN_PASSWORD_MIN_LENGTH) {
      return fail('PASSWORD_TOO_WEAK', { minLength: ADMIN_PASSWORD_MIN_LENGTH });
    }
    const role = cmd.role;
    const { uow, clock, admins, passwords, totp } = this.deps;
    const passwordHash = await passwords.hash(cmd.password);
    const totpSecret = totp.generateSecret();

    return uow.run(async (tx) => {
      const admin = AdminUser.create(
        { id: newId<'AdminUser'>(), email: email.value, passwordHash, totpSecret, role },
        clock.now(),
      );
      if (!(await admins.insert(tx, admin))) return fail('ADMIN_EMAIL_TAKEN');
      return ok({ adminId: admin.id, otpauthUri: totp.otpauthUri(totpSecret, email.value.value) });
    });
  }
}
