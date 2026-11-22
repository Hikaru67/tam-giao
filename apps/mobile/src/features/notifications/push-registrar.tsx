import { useEffect } from 'react';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  deviceResponseSchema,
  EXPO_PUSH_TOKEN_PATTERN,
  type DevicePlatform,
} from '@tamgiao/contracts/notification';
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useTokenStore } from '../../session/token-store-context.js';
import { setRegisteredDeviceId } from './device-state.js';
import { useNotificationResponseRouter } from './router.js';

/**
 * Component đăng ký Push Token và lắng nghe thông báo:
 * 1. Chỉ thực thi khi người dùng đã đăng nhập (có access token) và là thiết bị thật (`Device.isDevice`).
 * 2. Xin quyền thông báo; nếu được cấp quyền, đọc projectId từ `Constants.expoConfig?.extra?.eas?.projectId`.
 *    Nếu thiếu projectId thì bỏ qua đăng ký an toàn và không crash ứng dụng.
 * 3. Lấy Expo push token và kiểm tra khớp pattern `EXPO_PUSH_TOKEN_PATTERN`.
 * 4. Gọi POST /me/devices { token, platform: Platform.OS } và lưu `deviceId` vào module memory state.
 * 5. Lắng nghe sự kiện token thay đổi (`addPushTokenListener`) để tự động đăng ký lại.
 * 6. Lắng nghe sự kiện người dùng bấm vào thông báo để điều hướng màn hình qua `useNotificationResponseRouter`.
 */
export function PushRegistrar() {
  const client = useApiClient();
  const tokenStore = useTokenStore();
  const queryClient = useQueryClient();

  useNotificationResponseRouter();

  useEffect(() => {
    let cancelled = false;

    async function registerDeviceToken(pushToken: string) {
      if (!EXPO_PUSH_TOKEN_PATTERN.test(pushToken)) {
        return;
      }
      const platform: DevicePlatform = Platform.OS === 'ios' ? 'ios' : 'android';
      try {
        const response = await client.post('/me/devices', {
          body: { token: pushToken, platform },
          schema: deviceResponseSchema,
        });
        if (!cancelled && response?.deviceId) {
          setRegisteredDeviceId(response.deviceId);
        }
      } catch {
        // Lỗi mạng hoặc server khi đăng ký token bỏ qua, không chặn luồng app
      }
    }

    async function tryRegister() {
      // 1. Chỉ khi đã đăng nhập (có access token)
      const accessToken = await tokenStore.getAccessToken();
      if (!accessToken || cancelled) {
        return;
      }

      // 2. Chỉ khi là thiết bị thật
      if (!Device.isDevice) {
        return;
      }

      // 3. Xin quyền thông báo
      let existingStatus: string | undefined;
      try {
        const permission = await Notifications.getPermissionsAsync();
        existingStatus = permission?.status;
      } catch {
        return;
      }

      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        try {
          const permission = await Notifications.requestPermissionsAsync();
          finalStatus = permission?.status;
        } catch {
          return;
        }
      }

      if (finalStatus !== 'granted' || cancelled) {
        return;
      }

      // 4. Đọc projectId từ Constants.expoConfig?.extra?.eas?.projectId
      const expoConfig = Constants.expoConfig as { extra?: { eas?: { projectId?: string } } } | undefined;
      const projectId = expoConfig?.extra?.eas?.projectId;
      if (!projectId || cancelled) {
        return;
      }

      // 5. Lấy Expo push token
      try {
        const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
        if (!cancelled && tokenResult?.data) {
          await registerDeviceToken(tokenResult.data);
        }
      } catch {
        // Lấy token thất bại bỏ qua an toàn
      }
    }

    void tryRegister();

    // Lắng nghe khi token thay đổi trên thiết bị
    const tokenSub = Notifications.addPushTokenListener?.((tokenData) => {
      if (tokenData?.data) {
        void registerDeviceToken(tokenData.data);
      }
    });

    // Lắng nghe khi người dùng vừa đăng nhập (query cache 'me' thay đổi)
    const cacheUnsub = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === 'me') {
        void tryRegister();
      }
    });

    return () => {
      cancelled = true;
      tokenSub?.remove?.();
      cacheUnsub?.();
    };
  }, [client, tokenStore, queryClient]);

  return null;
}
