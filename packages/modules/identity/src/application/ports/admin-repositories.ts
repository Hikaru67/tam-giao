import type { Tx } from '@tamgiao/kernel';
import type { AdminSession } from '../../domain/admin-session.js';
import type { AdminEmail, AdminUser, AdminUserId } from '../../domain/admin-user.js';

export interface AdminUserRepository {
  /** Đọc và **khoá dòng** tới hết `tx` — các lần đăng nhập đồng thời của cùng tài khoản chạy tuần tự (đếm lần sai chính xác). */
  findByEmailForUpdate(tx: Tx, email: AdminEmail): Promise<AdminUser | null>;
  findById(tx: Tx, id: AdminUserId): Promise<AdminUser | null>;
  /** Thêm mới; email trùng → `false` (ràng buộc unique ở DB). */
  insert(tx: Tx, admin: AdminUser): Promise<boolean>;
  /** Cập nhật trạng thái đăng nhập (đếm lần sai, khoá, bước TOTP cuối). */
  update(tx: Tx, admin: AdminUser): Promise<void>;
}

export interface AdminSessionRepository {
  findByTokenHash(tx: Tx, tokenHash: string): Promise<AdminSession | null>;
  save(tx: Tx, session: AdminSession): Promise<void>;
}
