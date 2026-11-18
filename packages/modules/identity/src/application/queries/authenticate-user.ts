import { fail, ok, type Clock, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { SessionId } from '../../domain/session.js';
import type { AuthenticatedUser } from '../facade.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { AccessTokenError, AccessTokenService } from '../ports/token-services.js';

export interface AuthenticateUserDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly sessions: SessionRepository;
  readonly accessTokens: AccessTokenService;
}

/**
 * Xác thực access token của một request. Ngoài chữ ký + hạn, còn kiểm tra phiên chưa bị thu hồi
 * để đăng xuất / phát hiện lộ token có hiệu lực ngay (không phải chờ token 15 phút hết hạn).
 */
export class AuthenticateUser {
  constructor(private readonly deps: AuthenticateUserDeps) {}

  async execute(accessToken: string): Promise<Result<AuthenticatedUser, AccessTokenError>> {
    const { uow, clock, sessions, accessTokens } = this.deps;
    const claims = accessTokens.verify(accessToken, clock.now());
    if (claims.isErr()) return claims;

    return uow.run(async (tx) => {
      const session = await sessions.findById(tx, claims.value.sessionId as SessionId);
      if (!session || !session.isActive || session.userId !== claims.value.userId) {
        return fail('UNAUTHENTICATED');
      }
      return ok({ userId: session.userId, sessionId: session.id });
    });
  }
}
