import { fail, ok, type Clock, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { RefreshError } from '../../domain/session.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { RefreshTokenSecrets } from '../ports/token-services.js';
import type { AuthTokens, SessionIssuer } from '../session-issuer.js';

export interface RefreshSessionDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly sessions: SessionRepository;
  readonly refreshSecrets: RefreshTokenSecrets;
  readonly issuer: SessionIssuer;
}

/** Đổi refresh token lấy cặp token mới (xoay vòng). Token cũ dùng lại → thu hồi cả phiên (`TOKEN_REUSED`). */
export class RefreshSession {
  constructor(private readonly deps: RefreshSessionDeps) {}

  async execute(cmd: { readonly refreshToken: string }): Promise<Result<AuthTokens, RefreshError>> {
    const { uow, clock, sessions, refreshSecrets, issuer } = this.deps;
    const now = clock.now();

    // Việc thu hồi phiên khi phát hiện tái sử dụng phải được commit → transaction trả `ok(<kết quả nghiệp vụ>)`.
    const committed = await uow.run<Result<AuthTokens, RefreshError>, never>(async (tx) => {
      const token = await sessions.findRefreshTokenForUpdate(tx, refreshSecrets.hash(cmd.refreshToken));
      if (!token) return ok(fail('UNAUTHENTICATED'));
      const session = await sessions.findById(tx, token.sessionId);
      if (!session) return ok(fail('UNAUTHENTICATED'));

      const rotation = session.rotate(token, now);
      await sessions.save(tx, session);
      if (rotation.isErr()) return ok(fail(rotation.error.code));

      await sessions.markRefreshTokenUsed(tx, token.id, now);
      return ok(ok(await issuer.issueTokens(tx, session, now)));
    });
    if (committed.isErr()) throw new Error('unreachable: transaction RefreshSession không trả Err');
    return committed.value;
  }
}
