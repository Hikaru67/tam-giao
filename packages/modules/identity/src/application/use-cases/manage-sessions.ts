import {
  fail,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { SessionId, SessionRevokeReason } from '../../domain/session.js';
import type { UserId } from '../../domain/user.js';
import type { SessionRepository } from '../ports/session-repository.js';

export interface SessionsDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly sessions: SessionRepository;
}

export interface DeviceSession {
  readonly id: string;
  readonly deviceName: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  /** Phiên của chính request đang gọi. */
  readonly current: boolean;
}

/** Danh sách thiết bị đang đăng nhập của người dùng. */
export class ListSessions {
  constructor(private readonly deps: SessionsDeps) {}

  async execute(query: {
    readonly userId: string;
    readonly currentSessionId: string;
  }): Promise<DeviceSession[]> {
    const result = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.sessions.listActiveByUser(tx, query.userId as UserId)),
    );
    if (result.isErr()) throw new Error('unreachable');
    return result.value.map((session) => {
      const s = session.toState();
      return {
        id: s.id,
        deviceName: s.deviceName,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        current: s.id === query.currentSessionId,
      };
    });
  }
}

/** Thu hồi một phiên của chính người dùng (đăng xuất, hoặc gỡ một thiết bị khỏi danh sách). Idempotent. */
export class RevokeSession {
  constructor(private readonly deps: SessionsDeps) {}

  async execute(cmd: {
    readonly userId: string;
    readonly sessionId: string;
    readonly reason: Extract<SessionRevokeReason, 'LOGOUT' | 'REVOKED_BY_USER'>;
  }): Promise<Result<void, DomainError<'NOT_FOUND'>>> {
    const sessionId = parseId<'Session'>(cmd.sessionId);
    if (sessionId.isErr()) return fail('NOT_FOUND');
    const { uow, clock, sessions } = this.deps;

    return uow.run(async (tx) => {
      const session = await sessions.findById(tx, sessionId.value as SessionId);
      // Phiên của người khác trả NOT_FOUND như không tồn tại để không lộ id hợp lệ.
      if (!session || session.userId !== cmd.userId) return fail('NOT_FOUND');
      session.revoke(cmd.reason, clock.now());
      await sessions.save(tx, session);
      return ok();
    });
  }
}
