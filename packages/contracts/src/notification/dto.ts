import { z } from 'zod';

/**
 * DTO module notification (BE-S7-05): đăng ký thiết bị nhận push + cài đặt nhận thông báo. Push gửi qua Expo; nội dung
 * push không chứa PII (không tên đối phương, không nội dung tin nhắn) — app tự tải chi tiết theo `data` sau khi mở.
 */

export const DEVICE_PLATFORMS = ['ios', 'android'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** Expo push token: `ExponentPushToken[...]` (hoặc dạng mới `ExpoPushToken[...]`). */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/;

/** `POST /me/devices` — đăng ký (hoặc làm mới) token của thiết bị đang đăng nhập. Token đã thuộc người khác → chuyển chủ. */
export const registerDeviceBodySchema = z.object({
  token: z.string().regex(EXPO_PUSH_TOKEN_PATTERN, 'Expo push token không hợp lệ'),
  platform: z.enum(DEVICE_PLATFORMS),
});
export type RegisterDeviceBody = z.infer<typeof registerDeviceBodySchema>;

export const deviceResponseSchema = z.object({
  deviceId: z.uuid(),
  platform: z.enum(DEVICE_PLATFORMS),
  registeredAt: z.iso.datetime(),
});
export type DeviceResponse = z.infer<typeof deviceResponseSchema>;

/**
 * Nhóm thông báo. `ACCOUNT` (kết quả xác thực, hoàn tiền) và `SAFETY` (báo cáo vi phạm) là thông báo giao dịch/an toàn
 * — luôn bật, không tắt được. Người dùng chỉ tắt/bật được `MATCH`, `MESSAGE`, `DATE`.
 */
export const NOTIFICATION_CATEGORY_NAMES = ['MATCH', 'MESSAGE', 'DATE', 'ACCOUNT', 'SAFETY'] as const;
export type NotificationCategoryName = (typeof NOTIFICATION_CATEGORY_NAMES)[number];

/**
 * Loại thông báo (`data.kind` trong push — app dùng để điều hướng). Khớp `NOTIFICATION_KINDS` của domain notification
 * (có test đối chiếu).
 */
export const NOTIFICATION_KIND_NAMES = [
  'MATCH_OFFERED',
  'MATCH_OFFER_EXPIRING',
  'MATCH_AWAITING_RESPONSE',
  'MATCH_STARTED_DATING',
  'MESSAGE_RECEIVED',
  'DATE_PROPOSED',
  'DATE_CONFIRMED',
  'DATE_REMINDER',
  'KYC_APPROVED',
  'KYC_REJECTED',
  'REFUND_COMPLETED',
  'REPORT_RECEIVED',
  'REPORT_UPDATED',
] as const;
export type NotificationKindName = (typeof NOTIFICATION_KIND_NAMES)[number];

/** `PUT /me/notification-settings` (gửi đủ 3 trường). Mặc định khi chưa cài đặt: bật hết. */
export const notificationSettingsBodySchema = z.object({
  matches: z.boolean(),
  messages: z.boolean(),
  dates: z.boolean(),
});
export type NotificationSettingsBody = z.infer<typeof notificationSettingsBodySchema>;

/** `GET|PUT /me/notification-settings`. */
export const notificationSettingsResponseSchema = notificationSettingsBodySchema.extend({
  /** Nhóm luôn bật (không tắt được). */
  alwaysOn: z.array(z.enum(NOTIFICATION_CATEGORY_NAMES)),
});
export type NotificationSettingsResponse = z.infer<typeof notificationSettingsResponseSchema>;
