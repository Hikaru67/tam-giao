import type { Clock, Tx } from '@tamgiao/kernel';
import type { UserId } from '../../domain/user.js';
import type { BannedUserRegistry } from '../ports/banned-user-registry.js';
import type { SessionRepository } from '../ports/session-repository.js';

export interface BlockBannedUserDeps {
  readonly clock: Clock;
  readonly sessions: SessionRepository;
  readonly bannedUsers: BannedUserRegistry;
}

/**
 * Phản ứng của identity với `UserBanned` (BE-S6-06) — consumer gọi trong transaction của `deliverOnce`:
 * 1. đánh dấu tài khoản bị khoá → `VerifyOtp` không mở phiên mới (`ACCOUNT_BANNED`);
 * 2. thu hồi **mọi** phiên đang hoạt động (lý do `USER_BANNED`) → access token bị `AuthenticateUser` từ chối ngay,
 *    refresh token của phiên đã thu hồi không xoay được (`UNAUTHENTICATED`).
 * Idempotent (A9): chạy lại không còn phiên hoạt động, đánh dấu ghi đè. Trả số phiên vừa thu hồi (để log).
 */
export class BlockBannedUser {
  constructor(private readonly deps: BlockBannedUserDeps) {}

  async handle(tx: Tx, cmd: { readonly userId: string }): Promise<number> {
    const now = this.deps.clock.now();
    await this.deps.bannedUsers.markBanned(tx, cmd.userId, now);
    const active = await this.deps.sessions.listActiveByUser(tx, cmd.userId as UserId);
    for (const session of active) {
      session.revoke('USER_BANNED', now);
      await this.deps.sessions.save(tx, session);
    }
    return active.length;
  }
}
