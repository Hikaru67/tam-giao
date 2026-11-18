import type { Tx } from '@tamgiao/kernel';
import type { Preferences } from '../../domain/preferences.js';

export interface PreferencesRepository {
  findById(tx: Tx, userId: string): Promise<Preferences | null>;
  /** Khoá dòng tới hết `tx` (hai lần lưu đồng thời chạy tuần tự, version event không đụng nhau). */
  findByIdForUpdate(tx: Tx, userId: string): Promise<Preferences | null>;
  /** Upsert theo `userId` + ghi event chưa phát vào outbox trong cùng `tx`. */
  save(tx: Tx, preferences: Preferences): Promise<void>;
}
