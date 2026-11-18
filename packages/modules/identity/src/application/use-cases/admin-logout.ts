import { ok, type Clock, type UnitOfWork } from '@tamgiao/kernel';
import type { AdminSessionRepository } from '../ports/admin-repositories.js';
import type { RefreshTokenSecrets } from '../ports/token-services.js';

export interface AdminLogoutDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly sessions: AdminSessionRepository;
  readonly tokens: RefreshTokenSecrets;
}

/** Thu hồi phiên admin hiện tại. Idempotent. */
export class AdminLogout {
  constructor(private readonly deps: AdminLogoutDeps) {}

  async execute(token: string): Promise<void> {
    const { uow, clock, sessions, tokens } = this.deps;
    await uow.run(async (tx) => {
      const session = await sessions.findByTokenHash(tx, tokens.hash(token));
      if (session) {
        session.revoke(clock.now());
        await sessions.save(tx, session);
      }
      return ok();
    });
  }
}
