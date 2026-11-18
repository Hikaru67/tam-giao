/**
 * Bảng phân quyền của cổng vận hành (BE-S2-03). Module khác tham chiếu tên permission qua
 * `@tamgiao/contracts` (`ADMIN_PERMISSIONS`); test `permissions.test.ts` giữ hai danh sách khớp nhau.
 */
export const ADMIN_ROLES = ['REVIEWER', 'MATCHMAKER', 'SUPERVISOR', 'ADMIN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  /** Xem hàng chờ / chi tiết hồ sơ eKYC. */
  'kyc:review',
  /** Duyệt / từ chối / yêu cầu bổ sung eKYC. */
  'kyc:decide',
  /** Đề xuất ghép đôi. */
  'match:propose',
  /** Khoá vĩnh viễn người dùng. */
  'safety:ban',
  /** Hoàn tiền thủ công. */
  'billing:refund',
  /** Quản lý quán đối tác. */
  'partner:manage',
  /** Xem audit log. */
  'audit:read',
  /** Quản lý tài khoản admin. */
  'admin:manage',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const REVIEWER: readonly AdminPermission[] = ['kyc:review', 'kyc:decide'];
const MATCHMAKER: readonly AdminPermission[] = ['match:propose'];
const SUPERVISOR: readonly AdminPermission[] = [
  ...REVIEWER,
  ...MATCHMAKER,
  'safety:ban',
  'billing:refund',
  'audit:read',
];

/** Role → permission. `ADMIN` có mọi quyền. */
export const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  REVIEWER,
  MATCHMAKER,
  SUPERVISOR,
  ADMIN: ADMIN_PERMISSIONS,
};

export const isAdminRole = (value: string): value is AdminRole =>
  (ADMIN_ROLES as readonly string[]).includes(value);

export const hasPermission = (role: AdminRole, permission: string): boolean =>
  (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission);
