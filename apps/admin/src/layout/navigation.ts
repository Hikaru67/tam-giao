import type { AdminPermissionName } from '@tamgiao/contracts/identity';
import { NAV_COPY } from './copy';

/** Tên icon của mục menu — vẽ bởi `NavIcon` (`nav-icon.tsx`). */
export const NAV_ICONS = [
  'overview',
  'kyc',
  'interviews',
  'matching',
  'moderation',
  'partners',
  'appearance-flags',
  'refunds',
  'reconciliation',
  'audit',
] as const;
export type NavIconName = (typeof NAV_ICONS)[number];

export interface NavItem {
  readonly id: string;
  /** Đường dẫn tuyệt đối của route (khai báo trong `router.tsx`). */
  readonly to:
    | '/'
    | '/kyc'
    | '/interviews'
    | '/matching'
    | '/moderation'
    | '/partners'
    | '/operations/appearance-flags'
    | '/operations/refunds'
    | '/operations/reconciliation'
    | '/audit';
  readonly label: string;
  readonly icon: NavIconName;
  /** Permission BE yêu cầu cho API của màn; `null` = mọi admin đã đăng nhập. Route dùng cùng permission. */
  readonly permission: AdminPermissionName | null;
}

/**
 * Bảng menu ↔ permission (nguồn chân lý cho sidebar và guard route).
 * Permission khớp guard BE: `/admin/kyc/submissions*` + `/admin/kyc/interview/*` → `kyc:review`,
 * `/admin/reports*` + `/admin/flagged-messages*` → `safety:ban`,
 * `/admin/partners*` → `partner:manage`,
 * `/admin/audit-logs` → `audit:read`. Task sau thêm màn: thêm một dòng ở đây + route trong `router.tsx`.
 */
export const NAV_ITEMS = [
  { id: 'overview', to: '/', label: NAV_COPY.overview, icon: 'overview', permission: null },
  { id: 'kyc', to: '/kyc', label: NAV_COPY.kyc, icon: 'kyc', permission: 'kyc:review' },
  {
    id: 'interviews',
    to: '/interviews',
    label: NAV_COPY.interviews,
    icon: 'interviews',
    permission: 'kyc:review',
  },
  {
    id: 'matching',
    to: '/matching',
    label: NAV_COPY.matching,
    icon: 'matching',
    permission: 'match:propose',
  },
  {
    id: 'moderation',
    to: '/moderation',
    label: NAV_COPY.moderation,
    icon: 'moderation',
    permission: 'safety:ban',
  },
  {
    id: 'partners',
    to: '/partners',
    label: NAV_COPY.partners,
    icon: 'partners',
    permission: 'partner:manage',
  },
  {
    id: 'appearance-flags',
    to: '/operations/appearance-flags',
    label: NAV_COPY.appearanceFlags,
    icon: 'appearance-flags',
    permission: 'kyc:review',
  },
  {
    id: 'refunds',
    to: '/operations/refunds',
    label: NAV_COPY.refunds,
    icon: 'refunds',
    permission: 'billing:refund',
  },
  {
    id: 'reconciliation',
    to: '/operations/reconciliation',
    label: NAV_COPY.reconciliation,
    icon: 'reconciliation',
    permission: 'billing:refund',
  },
  { id: 'audit', to: '/audit', label: NAV_COPY.audit, icon: 'audit', permission: 'audit:read' },
] as const satisfies readonly NavItem[];

/** Các mục menu admin được thấy với danh sách permission hiện có. */
export function visibleNavItems(permissions: readonly AdminPermissionName[]): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.permission === null || permissions.includes(item.permission));
}
