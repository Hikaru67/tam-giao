import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useApiClient } from '@tamgiao/api-client/react';
import type { PartnerLoginBody } from '@tamgiao/contracts/billing';
import { partnerLogin, PARTNER_ME_QUERY_KEY, meFromSession } from './partner-auth-api';
import { usePartnerTokenStore } from './partner-session-context';

export function usePartnerLogin() {
  const client = useApiClient();
  const tokenStore = usePartnerTokenStore();
  const queryClient = useQueryClient();

  return useMutation({
    // PIN nằm trong biến của mutation: không giữ lại trong cache sau khi xong.
    gcTime: 0,
    mutationFn: (body: PartnerLoginBody) => partnerLogin(client, body),
    onSuccess: async (res) => {
      await tokenStore.setPartnerToken(res.token);
      queryClient.setQueryData(PARTNER_ME_QUERY_KEY, meFromSession(res));
    },
  });
}

export function usePartnerLogout() {
  const tokenStore = usePartnerTokenStore();
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async () => {
      // Backend không có endpoint logout riêng cho partner; phiên tự kết thúc khi hết hạn
    },
    onSettled: async () => {
      await tokenStore.clear();
      queryClient.clear();
      await router.navigate({ to: '/login' });
    },
  });
}
