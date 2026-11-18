import { fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { ROLE_PERMISSIONS } from '../../domain/permissions.js';
import type { AuthenticatedAdmin } from '../facade.js';
import type { AdminSessionRepository, AdminUserRepository } from '../ports/admin-repositories.js';
import type { RefreshTokenSecrets } from '../ports/token-services.js';

export interface AuthenticateAdminDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly admins: AdminUserRepository;
  readonly sessions: AdminSessionRepository;
  readonly tokens: RefreshTokenSecrets;
}

/**
 * Xác thực token phiên admin. Role/permission đọc lại từ DB mỗi request → đổi role có hiệu lực ngay,
 * không cần đợi phiên hết hạn.
 */
export class AuthenticateAdmin {
  constructor(private readonly deps: AuthenticateAdminDeps) {}

  async execute(token: string): Promise<Result<AuthenticatedAdmin, DomainError<'UNAUTHENTICATED'>>> {
    const { uow, clock, admins, sessions, tokens } = this.deps;
    return uow.run(async (tx) => {
      const session = await sessions.findByTokenHash(tx, tokens.hash(token));
      if (!session || !session.isValidAt(clock.now())) return fail('UNAUTHENTICATED');
      const admin = await admins.findById(tx, session.adminId);
      if (!admin) return fail('UNAUTHENTICATED');
      return ok({
        adminId: admin.id,
        sessionId: session.id,
        role: admin.role,
        permissions: ROLE_PERMISSIONS[admin.role],
      });
    });
  }
}
