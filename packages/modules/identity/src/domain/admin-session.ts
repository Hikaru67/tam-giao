import { Entity, addDuration, type Id } from '@tamgiao/kernel';
import type { AdminUserId } from './admin-user.js';

export type AdminSessionId = Id<'AdminSession'>;

/** Phiên admin ngắn: 8 giờ; chọn "ghi nhớ thiết bị" thì 12 giờ (BE-S2-03). Hết hạn là phải đăng nhập lại. */
export const ADMIN_SESSION_TTL_HOURS = 8;
export const ADMIN_REMEMBERED_SESSION_TTL_HOURS = 12;

export interface AdminSessionState {
  readonly id: AdminSessionId;
  readonly adminId: AdminUserId;
  /** Hash của token phiên (token gốc chỉ trả cho client một lần). */
  readonly tokenHash: string;
  readonly rememberDevice: boolean;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export class AdminSession extends Entity<AdminSessionId> {
  private constructor(private state: AdminSessionState) {
    super(state.id);
  }

  static start(
    input: Pick<AdminSessionState, 'id' | 'adminId' | 'tokenHash' | 'rememberDevice'>,
    now: Date,
  ): AdminSession {
    const hours = input.rememberDevice ? ADMIN_REMEMBERED_SESSION_TTL_HOURS : ADMIN_SESSION_TTL_HOURS;
    return new AdminSession({
      ...input,
      createdAt: now,
      expiresAt: addDuration(now, { hours }),
      revokedAt: null,
    });
  }

  static restore(state: AdminSessionState): AdminSession {
    return new AdminSession(state);
  }

  get adminId(): AdminUserId {
    return this.state.adminId;
  }
  get expiresAt(): Date {
    return this.state.expiresAt;
  }

  isValidAt(now: Date): boolean {
    return this.state.revokedAt === null && now.getTime() < this.state.expiresAt.getTime();
  }

  /** Idempotent. */
  revoke(now: Date): void {
    if (this.state.revokedAt === null) this.state = { ...this.state, revokedAt: now };
  }

  toState(): AdminSessionState {
    return this.state;
  }
}
