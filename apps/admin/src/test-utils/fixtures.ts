import {
  ADMIN_PERMISSIONS,
  type AdminPermissionName,
  type AdminRoleName,
  type AdminLoginResponse,
  type AdminMeResponse,
} from '@tamgiao/contracts/identity';

export const ADMIN_ID = '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e8f';

export const ROLE_PERMISSIONS_FIXTURE = {
  REVIEWER: ['kyc:review', 'kyc:decide'],
  MATCHMAKER: ['match:propose'],
  SUPERVISOR: ['kyc:review', 'kyc:decide', 'match:propose', 'safety:ban', 'billing:refund', 'audit:read'],
  ADMIN: [...ADMIN_PERMISSIONS],
} as const satisfies Record<AdminRoleName, readonly AdminPermissionName[]>;

export function adminMe(role: AdminRoleName): AdminMeResponse {
  return {
    adminId: ADMIN_ID,
    role,
    permissions: [...ROLE_PERMISSIONS_FIXTURE[role]],
  };
}

export function adminLoginResponse(role: AdminRoleName, token = 'admin-session-token'): AdminLoginResponse {
  return {
    token,
    expiresAt: '2026-11-22T20:00:00.000Z',
    admin: {
      id: ADMIN_ID,
      email: 'reviewer@tamgiao.test',
      role,
      permissions: [...ROLE_PERMISSIONS_FIXTURE[role]],
    },
  };
}
