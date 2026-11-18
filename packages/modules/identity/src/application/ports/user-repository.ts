import type { Tx } from '@tamgiao/kernel';
import type { PhoneNumber } from '../../domain/phone-number.js';
import type { User } from '../../domain/user.js';

export interface UserRepository {
  findByPhone(tx: Tx, phone: PhoneNumber): Promise<User | null>;
  /** Lưu user và ghi event đang chờ vào outbox trong cùng `tx` (AGENTS.md A6). */
  save(tx: Tx, user: User): Promise<void>;
}
