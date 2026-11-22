import { useApiClient } from '@tamgiao/api-client/react';
import { meResponseSchema, type MeResponse } from '@tamgiao/contracts/profile';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

export interface UseMeOptions {
  enabled?: boolean;
}

/**
 * Hook truy xuất thông tin tài khoản và trạng thái onboarding hiện tại (/me).
 */
export function useMe(options?: UseMeOptions): UseQueryResult<MeResponse, Error> {
  const client = useApiClient();

  return useQuery({
    queryKey: ['me'],
    queryFn: () => client.get('/me', { schema: meResponseSchema }),
    enabled: options?.enabled,
  });
}
