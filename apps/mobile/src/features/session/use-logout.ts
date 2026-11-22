import { useApiClient } from '@tamgiao/api-client/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTokenStore } from '../../session/token-store-context.js';
import { getRegisteredDeviceId, setRegisteredDeviceId } from '../notifications/device-state.js';

/**
 * Hook xử lý đăng xuất người dùng:
 * 1. Nếu có deviceId đã đăng ký -> DELETE /me/devices/:deviceId (lỗi bỏ qua).
 * 2. Gửi request POST /auth/logout (lỗi mạng hay 401 thì vẫn tiếp tục).
 * 3. Xoá token trong secure token store.
 * 4. Xoá toàn bộ cache query trong bộ nhớ.
 * 5. Điều hướng về màn hình đăng nhập SĐT.
 */
export function useLogout() {
  const client = useApiClient();
  const tokenStore = useTokenStore();
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async () => {
      const deviceId = getRegisteredDeviceId();
      if (deviceId) {
        try {
          await client.delete(`/me/devices/${deviceId}`);
        } catch {
          // Lỗi mạng hoặc 4xx/5xx khi gỡ thiết bị thì vẫn tiếp tục
        }
        setRegisteredDeviceId(null);
      }
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
