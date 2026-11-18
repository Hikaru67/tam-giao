/**
 * Tên permission và role của cổng vận hành. Nguồn chân lý là bảng ở `identity/domain/permissions.ts`;
 * danh sách này cho module khác dùng ở presentation (`requireAdmin('kyc:review')`) và được test giữ khớp.
 */
export const ADMIN_ROLES = ['REVIEWER', 'MATCHMAKER', 'SUPERVISOR', 'ADMIN'] as const;
export type AdminRoleName = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  'kyc:review',
  'kyc:decide',
  'match:propose',
  'safety:ban',
  'billing:refund',
  'partner:manage',
  'audit:read',
  'admin:manage',
] as const;
export type AdminPermissionName = (typeof ADMIN_PERMISSIONS)[number];
