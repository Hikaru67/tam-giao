import type { Tx } from '@tamgiao/kernel';
import type { Profile, ProfileId } from '../../domain/profile.js';

export interface ProfileRepository {
  findById(tx: Tx, userId: ProfileId): Promise<Profile | null>;
  /** Đọc và khoá dòng tới hết `tx` — hai lần lưu đồng thời của cùng người dùng chạy tuần tự. */
  findByIdForUpdate(tx: Tx, userId: ProfileId): Promise<Profile | null>;
  /** Upsert theo `userId`; giải mã/mã hoá trường riêng tư; ghi event chưa phát vào outbox trong cùng `tx`. */
  save(tx: Tx, profile: Profile): Promise<void>;
}
