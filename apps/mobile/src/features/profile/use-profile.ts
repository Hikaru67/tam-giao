import { useApiClient } from '@tamgiao/api-client/react';
import {
  profileResponseSchema,
  type ProfileResponse,
  type UpdateProfileBody,
} from '@tamgiao/contracts/profile';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

export interface UseProfileOptions {
  enabled?: boolean;
}

/**
 * Hook truy xuất hồ sơ hiện tại của người dùng (GET /me/profile).
 */
export function useProfile(options?: UseProfileOptions): UseQueryResult<ProfileResponse, Error> {
  const client = useApiClient();

  return useQuery({
    queryKey: ['profile'],
    queryFn: () => client.get('/me/profile', { schema: profileResponseSchema }),
    enabled: options?.enabled,
  });
}

/**
 * Hook lưu thông tin hồ sơ người dùng (PUT /me/profile).
 * Khi submit = true thành công:
 * 1. Làm mới dữ liệu query ['me'] và ['profile']
 * 2. Điều hướng router.replace('/') để EntryScreen chuyển tới bước tiếp theo.
 * Khi submit = false (Lưu tạm) thành công:
 * 1. Làm mới dữ liệu query ['me'] và ['profile']
 */
export function useSaveProfile() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async (body: UpdateProfileBody): Promise<ProfileResponse> => {
      return client.put('/me/profile', {
        body,
        schema: profileResponseSchema,
      });
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
      ]);

      if (variables.submit) {
        router.replace('/');
      }
    },
  });
}
