import { useState } from 'react';
import { useApiClient } from '@tamgiao/api-client/react';
import { accountDeletionViewSchema, type AccountDeletionView } from '@tamgiao/contracts/identity';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTokenStore } from '../../session/token-store-context.js';

/**
 * Hook quản lý luồng xoá tài khoản và tiến độ xoá (FE-S2-06).
 * Quy trình:
 * 1. POST /me/account/deletion/otp: yêu cầu gửi OTP đến SĐT chính chủ.
 * 2. POST /me/account/deletion {code}: xác nhận xoá bằng mã OTP 6 số.
 * 3. Khi bắt đầu xử lý xoá:
 *    - tokenStore.clear(): xoá token khỏi secure store
 *    - queryClient.clear(): xoá toàn bộ cache query
 * 4. GET /account-deletions/:requestId: poll công khai (auth: false) để hiển thị tiến độ từng bước.
 */
export function useAccountDeletionFlow() {
  const client = useApiClient();
  const tokenStore = useTokenStore();
  const queryClient = useQueryClient();

  const [requestId, setRequestId] = useState<string | null>(null);

  const requestOtpMutation = useMutation({
    mutationFn: async () => {
      await client.post('/me/account/deletion/otp', {});
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await client.post('/me/account/deletion', {
        body: { code },
        schema: accountDeletionViewSchema,
      });

      setRequestId(res.requestId);

      // Thu hồi cục bộ ngay khi BE chấp nhận xoá tài khoản
      await tokenStore.clear();
      queryClient.clear();

      return res;
    },
  });

  const statusQuery = useQuery({
    queryKey: ['account-deletion-status', requestId],
    queryFn: () =>
      client.get(`/account-deletions/${requestId}`, {
        schema: accountDeletionViewSchema,
        auth: false,
      }),
    enabled: Boolean(requestId),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'PROCESSING' ? 2000 : false;
    },
  });

  const deletionView: AccountDeletionView | null = statusQuery.data ?? deleteAccountMutation.data ?? null;

  return {
    requestId,
    deletionView,
    isStatusLoading: statusQuery.isLoading,
    requestOtp: requestOtpMutation.mutateAsync,
    isRequestingOtp: requestOtpMutation.isPending,
    requestOtpError: requestOtpMutation.error,
    deleteAccount: deleteAccountMutation.mutateAsync,
    isDeleting: deleteAccountMutation.isPending,
    deleteError: deleteAccountMutation.error,
    resetDeletion: () => {
      setRequestId(null);
      requestOtpMutation.reset();
      deleteAccountMutation.reset();
    },
  };
}
