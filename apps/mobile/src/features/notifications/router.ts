import { useEffect } from 'react';
import type { NotificationKindName } from '@tamgiao/contracts/notification';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function resolveMatchRoute(data: Record<string, unknown>): string {
  const matchId = data.matchId ?? data.id;
  if (matchId !== undefined && !isValidUuid(matchId)) {
    return '/';
  }
  return '/(main)/home';
}

function resolveMessageRoute(data: Record<string, unknown>): string {
  const conversationId = data.conversationId ?? data.id;
  if (!isValidUuid(conversationId)) {
    return '/';
  }
  return `/(main)/chat/${conversationId}`;
}

function resolveDateRoute(data: Record<string, unknown>): string {
  const datePlanId = data.datePlanId ?? data.id;
  if (datePlanId !== undefined && datePlanId !== null && datePlanId !== '') {
    if (!isValidUuid(datePlanId)) {
      return '/';
    }
    return `/(main)/dates/${datePlanId}`;
  }
  const matchId = data.matchId;
  if (matchId !== undefined && !isValidUuid(matchId)) {
    return '/';
  }
  return '/(main)/dates';
}

function resolveAccountRoute(data: Record<string, unknown>): string {
  const id = data.submissionId ?? data.paymentId ?? data.id;
  if (id !== undefined && !isValidUuid(id)) {
    return '/';
  }
  return '/';
}

function resolveSafetyRoute(data: Record<string, unknown>): string {
  const reportId = data.reportId ?? data.id;
  if (reportId !== undefined && reportId !== null && reportId !== '' && !isValidUuid(reportId)) {
    return '/';
  }
  return '/(main)/safety';
}

/**
 * Bảng ánh xạ loại thông báo sang hàm tạo route tương ứng.
 * Sử dụng `satisfies Record<NotificationKindName, …>` để đảm bảo thiếu loại thông báo sẽ báo lỗi typecheck ngay lúc biên dịch.
 */
export const NOTIFICATION_ROUTES = {
  MATCH_OFFERED: resolveMatchRoute,
  MATCH_OFFER_EXPIRING: resolveMatchRoute,
  MATCH_AWAITING_RESPONSE: resolveMatchRoute,
  MATCH_STARTED_DATING: resolveMatchRoute,
  MESSAGE_RECEIVED: resolveMessageRoute,
  DATE_PROPOSED: resolveDateRoute,
  DATE_CONFIRMED: resolveDateRoute,
  DATE_REMINDER: resolveDateRoute,
  KYC_APPROVED: resolveAccountRoute,
  KYC_REJECTED: resolveAccountRoute,
  REFUND_COMPLETED: resolveAccountRoute,
  REPORT_RECEIVED: resolveSafetyRoute,
  REPORT_UPDATED: resolveSafetyRoute,
  DATING_REMINDER_FIRST: resolveDateRoute,
  DATING_REMINDER_FINAL: resolveDateRoute,
} satisfies Record<NotificationKindName, (data: Record<string, unknown>) => string>;

/**
 * Hàm điều hướng thuần túy khi bấm vào thông báo:
 * Nhận payload `data` từ Expo notification, phân giải loại thông báo `kind`
 * và trả về route đích. ID đi kèm phải là UUID hợp lệ; nếu sai định dạng trả về '/'.
 */
export function routeForNotification(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== 'string') {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(NOTIFICATION_ROUTES, kind)) {
    return null;
  }
  const resolver = NOTIFICATION_ROUTES[kind as NotificationKindName];
  return resolver(record);
}

/**
 * Hook lắng nghe sự kiện tương tác với thông báo đẩy:
 * 1. Khởi động lạnh (cold start): đọc thông báo đã mở qua `getLastNotificationResponseAsync`.
 * 2. Ứng dụng đang chạy/nền: lắng nghe qua `addNotificationResponseReceivedListener`.
 * Khi nhận được route hợp lệ, thực hiện `router.push(route)`.
 */
export function useNotificationResponseRouter() {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    void Notifications.getLastNotificationResponseAsync?.()
      .then((response) => {
        if (!mounted || !response) return;
        const data = response.notification?.request?.content?.data;
        const route = routeForNotification(data);
        if (route) {
          router.push(route as Href<string>);
        }
      })
      .catch(() => {
        // Bỏ qua lỗi khi đọc response khởi động
      });

    const subscription = Notifications.addNotificationResponseReceivedListener?.((response) => {
      const data = response.notification?.request?.content?.data;
      const route = routeForNotification(data);
      if (route) {
        router.push(route as Href<string>);
      }
    });

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, [router]);
}
