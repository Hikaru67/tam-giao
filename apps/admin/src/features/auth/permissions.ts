import type { AdminMeResponse, AdminPermissionName } from '@tamgiao/contracts/identity';

export function hasPermission(
  me: Pick<AdminMeResponse, 'permissions'>,
  permission: AdminPermissionName,
): boolean {
  return me.permissions.includes(permission);
}

/** Lỗi ném từ `beforeLoad` khi thiếu permission → `RouteError` hiển thị màn "không đủ quyền". */
export class ForbiddenError extends Error {
  readonly permission: AdminPermissionName;

  constructor(permission: AdminPermissionName) {
    super(`Missing admin permission ${permission}`);
    this.name = 'ForbiddenError';
    this.permission = permission;
  }
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError;
}

/**
 * `beforeLoad` cho route con của layout đã đăng nhập: `beforeLoad: requirePermission('kyc:review')`.
 * `context.me` do layout `_authed` nạp sẵn.
 */
export function requirePermission(permission: AdminPermissionName) {
  return ({ context }: { context: { me: AdminMeResponse } }): void => {
    if (!hasPermission(context.me, permission)) throw new ForbiddenError(permission);
  };
}
