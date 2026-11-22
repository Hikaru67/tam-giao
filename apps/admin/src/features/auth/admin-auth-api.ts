import type { ApiClient } from '@tamgiao/api-client';
import {
  adminLoginBodySchema,
  adminLoginResponseSchema,
  adminMeResponseSchema,
  type AdminLoginBody,
  type AdminLoginResponse,
  type AdminMeResponse,
} from '@tamgiao/contracts/identity';
import { queryOptions } from '@tanstack/react-query';

/** Query key phiên admin hiện tại (`GET /admin/auth/me`). Đăng xuất / 401 → `queryClient.clear()`. */
export const ADMIN_ME_QUERY_KEY = ['admin', 'auth', 'me'] as const;

/**
 * `POST /admin/auth/login` — không gửi Bearer (`auth: false`) để 401 `INVALID_CREDENTIALS` / `MFA_REQUIRED`
 * trả thẳng về form, không kích hoạt luồng đăng xuất của api-client.
 */
export function adminLogin(client: ApiClient, body: AdminLoginBody): Promise<AdminLoginResponse> {
  return client.post('/admin/auth/login', {
    body: adminLoginBodySchema.parse(body),
    schema: adminLoginResponseSchema,
    auth: false,
  });
}

export function fetchAdminMe(client: ApiClient, signal?: AbortSignal): Promise<AdminMeResponse> {
  return client.get('/admin/auth/me', { schema: adminMeResponseSchema, signal });
}

export async function adminLogout(client: ApiClient): Promise<void> {
  await client.post('/admin/auth/logout');
}

export function adminMeQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: ADMIN_ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchAdminMe(client, signal),
    staleTime: 60_000,
    retry: false,
  });
}

/** Chuyển response đăng nhập sang dạng `GET /admin/auth/me` để ghi sẵn cache, tránh gọi lại ngay sau login. */
export function meFromLogin(response: AdminLoginResponse): AdminMeResponse {
  return {
    adminId: response.admin.id,
    role: response.admin.role,
    permissions: response.admin.permissions,
  };
}
