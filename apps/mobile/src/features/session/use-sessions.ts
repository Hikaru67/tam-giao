import { useApiClient } from '@tamgiao/api-client/react';
import { listSessionsResponseSchema, type ListSessionsResponse } from '@tamgiao/contracts/identity';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

/**
 * Hook lấy danh sách thiết bị đăng nhập của tài khoản (GET /auth/sessions).
 */
export function useSessions(): UseQueryResult<ListSessionsResponse, Error> {
  const client = useApiClient();

  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => client.get('/auth/sessions', { schema: listSessionsResponseSchema }),
  });
}

/**
 * Hook thu hồi một phiên đăng nhập của thiết bị khác (DELETE /auth/sessions/:sessionId).
 */
export function useRevokeSession() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      await client.delete(`/auth/sessions/${sessionId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
