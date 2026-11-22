import { useApiClient } from '@tamgiao/api-client/react';
import {
  notificationSettingsResponseSchema,
  type NotificationSettingsBody,
  type NotificationSettingsResponse,
} from '@tamgiao/contracts/notification';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const NOTIFICATION_SETTINGS_QUERY_KEY = ['notification-settings'] as const;

/**
 * Hook tải cấu hình nhận thông báo của người dùng hiện tại (GET /me/notification-settings).
 */
export function useNotificationSettings() {
  const client = useApiClient();

  return useQuery({
    queryKey: NOTIFICATION_SETTINGS_QUERY_KEY,
    queryFn: () =>
      client.get('/me/notification-settings', {
        schema: notificationSettingsResponseSchema,
      }),
  });
}

/**
 * Hook cập nhật cấu hình nhận thông báo (PUT /me/notification-settings).
 */
export function useUpdateNotificationSettings() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: NotificationSettingsBody) =>
      client.put('/me/notification-settings', {
        body,
        schema: notificationSettingsResponseSchema,
      }),
    onSuccess: (data: NotificationSettingsResponse) => {
      queryClient.setQueryData(NOTIFICATION_SETTINGS_QUERY_KEY, data);
    },
  });
}
