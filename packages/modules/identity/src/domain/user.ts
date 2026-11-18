import { AggregateRoot, newId, type Id } from '@tamgiao/kernel';
import type { PhoneNumber } from './phone-number.js';

export type UserId = Id<'User'>;

export interface UserState {
  readonly id: UserId;
  readonly phone: PhoneNumber;
  readonly createdAt: Date;
  readonly version: number;
}

/** Tài khoản người dùng app, định danh bằng SĐT đã xác thực OTP. */
export class User extends AggregateRoot<UserId> {
  protected readonly aggregateType = 'User';

  private constructor(
    id: UserId,
    readonly phone: PhoneNumber,
    readonly createdAt: Date,
    version: number,
  ) {
    super(id, version);
  }

  /** Tạo tài khoản ở lần xác thực OTP đầu tiên của SĐT. Event không mang SĐT (PII). */
  static register(phone: PhoneNumber, now: Date): User {
    const user = new User(newId<'User'>(), phone, now, 0);
    user.record('UserRegistered', { userId: user.id }, now);
    return user;
  }

  static restore(state: UserState): User {
    return new User(state.id, state.phone, state.createdAt, state.version);
  }
}
