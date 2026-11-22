import { useEffect, useRef } from 'react';
import { NOTIFICATION_KIND_NAMES, type NotificationKindName } from '@tamgiao/contracts/notification';
import * as Notifications from 'expo-notifications';

function isNotificationKind(value: unknown): value is NotificationKindName {
  return NOTIFICATION_KIND_NAMES.some((kind) => kind === value);
}

/**
 * Đọc `data.kind` của push (BE gửi `{ kind, deliveryId, ...data }`). Trả `null` khi payload không đúng dạng hoặc
 * `kind` không thuộc `NOTIFICATION_KIND_NAMES`.
 */
export function notificationKindOf(data: unknown): NotificationKindName | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const kind: unknown = (data as { kind?: unknown }).kind;
  return isNotificationKind(kind) ? kind : null;
}

/**
 * Lắng nghe push nhận được khi app đang mở (foreground) và gọi `onReceive` nếu `data.kind` thuộc `kinds`.
 * Dùng để màn đang mở tự làm mới dữ liệu (vd invalidate query) — không điều hướng.
 */
export function useForegroundNotification(
  kinds: readonly NotificationKindName[],
  onReceive: (kind: NotificationKindName) => void,
): void {
  const onReceiveRef = useRef(onReceive);
  onReceiveRef.current = onReceive;
  const kindsKey = kinds.join(',');

  useEffect(() => {
    const accepted = new Set(kindsKey.split(','));
    const subscription = Notifications.addNotificationReceivedListener?.((notification) => {
      const kind = notificationKindOf(notification.request?.content?.data);
      if (kind !== null && accepted.has(kind)) {
        onReceiveRef.current(kind);
      }
    });
    return () => {
      subscription?.remove?.();
    };
  }, [kindsKey]);
}
