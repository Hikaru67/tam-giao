import { AggregateRoot, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';
import { USER_BANNED } from './report-events.js';

export type UserBanId = Id<'UserBan'>;

/** Độ dài tối đa lý do khoá (ký tự, sau khi trim). Khớp `BAN_REASON_MAX_LENGTH` ở contracts. */
export const BAN_REASON_MAX_LENGTH = 1000;

export type UserBanError = DomainError<'BAN_REASON_INVALID'>;

export interface UserBanState {
  readonly id: UserBanId;
  /** Id tài khoản app (module identity) — safety chỉ giữ tham chiếu (A3). */
  readonly userId: string;
  /** Lý do khoá — văn bản tự do, có thể chứa PII: KHÔNG log, KHÔNG đưa vào event/audit. */
  readonly reason: string;
  /** Báo cáo dẫn tới quyết định khoá (nếu khoá từ màn báo cáo). */
  readonly reportId: string | null;
  /** Admin ra quyết định. */
  readonly bannedBy: string;
  readonly bannedAt: Date;
  readonly version: number;
}

export interface BanUserInput {
  readonly id: UserBanId;
  readonly userId: string;
  readonly reason: string;
  readonly reportId?: string | null;
  readonly bannedBy: string;
}

/**
 * Aggregate `UserBan` — quyết định khoá **vĩnh viễn** một tài khoản (BE-S6-06). Tạo một lần, không có chuyển trạng
 * thái (gỡ khoá ngoài phạm vi). Mỗi người dùng tối đa một bản ghi — chốt bằng PK `user_id` ở DB (A10), trùng →
 * use case trả `USER_ALREADY_BANNED`.
 *
 * `ban`: lý do trim, rỗng hoặc dài hơn `BAN_REASON_MAX_LENGTH` → `BAN_REASON_INVALID`; phát `UserBanned`
 * (`{ banId, userId, bannedBy, reportId }`, không có lý do). Identity thu hồi phiên + chặn đăng nhập, matching loại khỏi
 * ứng viên + khoá match đang mở (consumer của từng module).
 */
export class UserBan extends AggregateRoot<UserBanId> {
  protected readonly aggregateType = 'UserBan';

  private constructor(
    private readonly state: Omit<UserBanState, 'version'>,
    version: number,
  ) {
    super(state.id, version);
  }

  static ban(input: BanUserInput, now: Date): Result<UserBan, UserBanError> {
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > BAN_REASON_MAX_LENGTH) {
      return fail('BAN_REASON_INVALID', { maxLength: BAN_REASON_MAX_LENGTH });
    }
    const ban = new UserBan(
      {
        id: input.id,
        userId: input.userId,
        reason,
        reportId: input.reportId ?? null,
        bannedBy: input.bannedBy,
        bannedAt: now,
      },
      0,
    );
    ban.record(
      USER_BANNED,
      { banId: ban.id, userId: input.userId, bannedBy: input.bannedBy, reportId: input.reportId ?? null },
      now,
    );
    return ok(ban);
  }

  static restore(state: UserBanState): UserBan {
    const { version, ...rest } = state;
    return new UserBan(rest, version);
  }

  get userId(): string {
    return this.state.userId;
  }

  get bannedAt(): Date {
    return this.state.bannedAt;
  }

  toState(): UserBanState {
    return { ...this.state, version: this.version };
  }
}
