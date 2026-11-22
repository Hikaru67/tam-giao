import { useApiClient } from '@tamgiao/api-client/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTokenStore } from '../../session/token-store-context.js';

/**
 * Hook xử lý đăng xuất người dùng:
 * 1. Gửi request POST /auth/logout (lỗi mạng hay 401 thì vẫn tiếp tục).
 * 2. Xoá token trong secure token store.
 * 3. Xoá toàn bộ cache query trong bộ nhớ.
 * 4. Điều hướng về màn hình đăng nhập SĐT.
 */
export function useLogout() {
  const client = useApiClient();
  const tokenStore = useTokenStore();
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async () => {
      try {
        await client.post('/auth/logout', { auth: true });
      } catch {
        // Lỗi mạng hoặc 401 vẫn tiếp tục — đăng xuất cục bộ luôn xảy ra
      }
      await tokenStore.clear();
      queryClient.clear();
      router.replace('/(auth)/phone');
    },
  });
}
