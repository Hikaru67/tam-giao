import type { Tx } from '@tamgiao/kernel';
import type { Partner, PartnerId } from '../../domain/partner.js';
import type { PartnerStaff, PartnerStaffId } from '../../domain/partner-staff.js';

export interface PartnerListFilter {
  /** `undefined` = mọi quán. */
  readonly active?: boolean | undefined;
}

/** Lưu trữ quán đối tác (`billing.partners`). */
export interface PartnerRepository {
  findById(tx: Tx, id: PartnerId): Promise<Partner | null>;
  findByIdForUpdate(tx: Tx, id: PartnerId): Promise<Partner | null>;
  /** Thêm mới hoặc ghi đè theo `id`. */
  save(tx: Tx, partner: Partner): Promise<void>;
  /** Sắp theo tên rồi `id`. */
  list(tx: Tx, filter: PartnerListFilter): Promise<Partner[]>;
}

/** Lưu trữ tài khoản nhân viên quán (`billing.partner_staff`). */
export interface PartnerStaffRepository {
  findById(tx: Tx, id: PartnerStaffId): Promise<PartnerStaff | null>;
  /** Khoá dòng — các lần đăng nhập đồng thời đếm sai PIN tuần tự, không mất lượt. */
  findByIdForUpdate(tx: Tx, id: PartnerStaffId): Promise<PartnerStaff | null>;
  /** Thêm mới hoặc ghi đè theo `id`. */
  save(tx: Tx, staff: PartnerStaff): Promise<void>;
  /** Sắp theo thời điểm tạo. */
  listByPartner(tx: Tx, partnerId: PartnerId): Promise<PartnerStaff[]>;
}
