import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useApiClient } from '@tamgiao/api-client/react';
import type { AdminLoginBody } from '@tamgiao/contracts/identity';
import { adminLogin, adminLogout, ADMIN_ME_QUERY_KEY, meFromLogin } from './admin-auth-api';
import { useAdminTokenStore } from './admin-session-context';

export function useAdminLogin() {
  const client = useApiClient();
  const tokenStore = useAdminTokenStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: AdminLoginBody) => adminLogin(client, body),
    onSuccess: async (res) => {
      await tokenStore.setAdminToken(res.token);
      queryClient.setQueryData(ADMIN_ME_QUERY_KEY, meFromLogin(res));
    },
  });
}

export function useAdminLogout() {
  const client = useApiClient();
  const tokenStore = useAdminTokenStore();
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => adminLogout(client),
    onSettled: async () => {
      await tokenStore.clear();
      queryClient.clear();
      await router.navigate({ to: '/login' });
    },
  });
}
