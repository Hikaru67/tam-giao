import { AggregateRoot, newId, type Id } from '@tamgiao/kernel';

export type AccountDeletionId = Id<'AccountDeletion'>;

export interface AccountDeletionState {
  readonly id: AccountDeletionId;
  readonly userId: string;
  readonly requestedAt: Date;
  /** `eventId` của `AccountDeletionRequested` — tiến độ từng module = consumer nào đã xử lý event này. */
  readonly eventId: string;
  readonly version: number;
}

/**
 * Yêu cầu xoá tài khoản (quyền xoá dữ liệu — NĐ 13/2023, BE-S7-06). Mỗi người dùng tối đa một yêu cầu
 * (`user_id` unique). Tạo yêu cầu phát `AccountDeletionRequested` — từng module tự ẩn danh/xoá dữ liệu của mình.
 * Event chỉ chứa id, không PII.
 */
export class AccountDeletion extends AggregateRoot<AccountDeletionId> {
  protected readonly aggregateType = 'AccountDeletion';

  private constructor(private state: AccountDeletionState) {
    super(state.id, state.version);
  }

  static request(userId: string, now: Date): AccountDeletion {
    const id = newId<'AccountDeletion'>();
    const deletion = new AccountDeletion({ id, userId, requestedAt: now, eventId: '', version: 0 });
    // eventId chỉ biết sau khi `record`.
    const event = deletion.record(
      'AccountDeletionRequested',
      { requestId: id, userId, requestedAt: now.toISOString() },
      now,
    );
    deletion.state = { ...deletion.state, eventId: event.eventId };
    return deletion;
  }

  static restore(state: AccountDeletionState): AccountDeletion {
    return new AccountDeletion(state);
  }

  get userId(): string {
    return this.state.userId;
  }

  get requestedAt(): Date {
    return this.state.requestedAt;
  }

  get eventId(): string {
    return this.state.eventId;
  }

  toState(): AccountDeletionState {
    return { ...this.state, version: this.version };
  }
}

/**
 * Khoá challenge OTP xác nhận xoá tài khoản — tách khỏi challenge đăng nhập (khoá theo blind index SĐT) để mã đăng nhập
 * không dùng được cho việc xoá và ngược lại.
 */
export const accountDeletionChallengeKey = (userId: string): string => `account-deletion:${userId}`;
