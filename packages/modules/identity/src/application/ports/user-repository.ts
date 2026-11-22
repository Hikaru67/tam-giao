import type { Tx } from '@tamgiao/kernel';
import type { PhoneNumber } from '../../domain/phone-number.js';
import type { User, UserId } from '../../domain/user.js';

export interface UserRepository {
  findByPhone(tx: Tx, phone: PhoneNumber): Promise<User | null>;
  /** Tài khoản chưa bị xoá (BE-S7-06); đã xoá / không có → `null`. */
  findActiveById(tx: Tx, id: UserId): Promise<User | null>;
  /**
   * Ẩn danh tài khoản khi xoá (BE-S7-06): xoá SĐT mã hoá, thay blind index SĐT bằng giá trị không trùng được (SĐT đăng ký
   * lại thành tài khoản mới), đặt `deleted_at`. Dòng `users` còn lại (id) vì phiên/audit tham chiếu tới.
   */
  anonymize(tx: Tx, id: UserId, now: Date): Promise<void>;
  /** Lưu user và ghi event đang chờ vào outbox trong cùng `tx` (AGENTS.md A6). */
  save(tx: Tx, user: User): Promise<void>;
}
