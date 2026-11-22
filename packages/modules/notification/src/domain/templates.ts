import {
  DATE_REMINDER_HOURS,
  DATING_DAYS,
  DATING_FINAL_REMINDER_DAY,
  DATING_FIRST_REMINDER_DAY,
  OFFER_EXPIRY_REMINDER_HOURS,
  OFFER_TTL_HOURS,
  REFUND_SLA_HOURS,
  RESPONSE_TTL_HOURS,
} from '@tamgiao/contracts/constants';
import { addDuration } from '@tamgiao/kernel';

/**
 * Template thông báo tiếng Việt theo loại (BE-S7-05). Luật bắt buộc: nội dung push hiện trên màn khoá nên **không chứa
 * PII** — không tên/ảnh đối phương, không nội dung tin nhắn, không số tiền/CCCD; chỉ câu chung + id trong `data` để app
 * tự tải chi tiết sau khi người dùng mở khoá.
 */

export const NOTIFICATION_KINDS = [
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
  'DATING_REMINDER_FIRST',
  'DATING_REMINDER_FINAL',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_CATEGORIES = ['MATCH', 'MESSAGE', 'DATE', 'ACCOUNT', 'SAFETY'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Thông báo giao dịch / an toàn: luôn gửi, cài đặt của người dùng không tắt được. */
export const ALWAYS_ON_CATEGORIES: readonly NotificationCategory[] = ['ACCOUNT', 'SAFETY'];

export interface NotificationTemplate {
  readonly kind: NotificationKind;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
  /** Không gửi được push (không có thiết bị / token hỏng hết) → gửi SMS thay thế. Chỉ cho thông báo giao dịch. */
  readonly smsFallback: boolean;
}

const TEMPLATES: { readonly [K in NotificationKind]: Omit<NotificationTemplate, 'kind'> } = {
  MATCH_OFFERED: {
    category: 'MATCH',
    title: 'Bạn có một gợi ý ghép đôi mới',
    body: `Chuyên viên vừa gửi bạn một gợi ý phù hợp. Bạn có ${OFFER_TTL_HOURS} giờ để cân nhắc.`,
    smsFallback: false,
  },
  MATCH_OFFER_EXPIRING: {
    category: 'MATCH',
    title: 'Gợi ý sắp hết hạn',
    body: `Còn ${OFFER_EXPIRY_REMINDER_HOURS} giờ để bạn phản hồi gợi ý ghép đôi.`,
    smsFallback: false,
  },
  MATCH_AWAITING_RESPONSE: {
    category: 'MATCH',
    title: 'Có người muốn tìm hiểu bạn',
    body: `Người được gợi ý đã đồng ý tìm hiểu. Hãy phản hồi trong ${RESPONSE_TTL_HOURS} giờ.`,
    smsFallback: false,
  },
  MATCH_STARTED_DATING: {
    category: 'MATCH',
    title: 'Hai bạn đã được kết nối',
    body: `Giai đoạn tìm hiểu ${DATING_DAYS} ngày bắt đầu. Hãy gửi lời chào đầu tiên.`,
    smsFallback: false,
  },
  MESSAGE_RECEIVED: {
    category: 'MESSAGE',
    title: 'Bạn có tin nhắn mới',
    body: 'Mở Tâm Giao để đọc tin nhắn.',
    smsFallback: false,
  },
  DATE_PROPOSED: {
    category: 'DATE',
    title: 'Bạn có lời mời gặp mặt',
    body: 'Hãy xem lịch hẹn và xác nhận sớm nhé.',
    smsFallback: false,
  },
  DATE_CONFIRMED: {
    category: 'DATE',
    title: 'Lịch hẹn đã được xác nhận',
    body: 'Xem chi tiết điểm hẹn an toàn trong ứng dụng.',
    smsFallback: false,
  },
  DATE_REMINDER: {
    category: 'DATE',
    title: 'Sắp đến giờ hẹn',
    body: `Buổi gặp của bạn bắt đầu sau ${DATE_REMINDER_HOURS} giờ nữa. Đừng quên bật Check-in an toàn.`,
    smsFallback: false,
  },
  KYC_APPROVED: {
    category: 'ACCOUNT',
    title: 'Hồ sơ đã được duyệt',
    body: 'Chúc mừng! Hồ sơ của bạn đã được xác thực. Mở ứng dụng để bắt đầu.',
    smsFallback: true,
  },
  KYC_REJECTED: {
    category: 'ACCOUNT',
    title: 'Cập nhật kết quả xác thực',
    body: `Hồ sơ của bạn chưa được duyệt. Phí xác thực sẽ được hoàn trong ${REFUND_SLA_HOURS} giờ.`,
    smsFallback: true,
  },
  REFUND_COMPLETED: {
    category: 'ACCOUNT',
    title: 'Đã hoàn tiền',
    body: 'Phí xác thực đã được hoàn lại cho bạn.',
    smsFallback: true,
  },
  REPORT_RECEIVED: {
    category: 'SAFETY',
    title: 'Đã nhận báo cáo của bạn',
    body: 'Chuyên viên an toàn sẽ xem xét và phản hồi bạn sớm nhất.',
    smsFallback: false,
  },
  REPORT_UPDATED: {
    category: 'SAFETY',
    title: 'Báo cáo của bạn có cập nhật',
    body: 'Mở ứng dụng để xem tình trạng xử lý.',
    smsFallback: false,
  },
  DATING_REMINDER_FIRST: {
    category: 'DATE',
    title: 'Đã nửa chặng tìm hiểu',
    body: `Hai bạn đã tìm hiểu được ${DATING_FIRST_REMINDER_DAY} ngày. Mục tiêu: gặp mặt trước ngày ${DATING_DAYS} — hãy hẹn một buổi gặp tại điểm hẹn an toàn.`,
    smsFallback: false,
  },
  DATING_REMINDER_FINAL: {
    category: 'DATE',
    title: 'Sắp hết giai đoạn tìm hiểu',
    body: `Còn ${DATING_DAYS - DATING_FINAL_REMINDER_DAY} ngày. Mục tiêu: gặp mặt trước ngày ${DATING_DAYS} — đặt lịch hẹn ngay trong ứng dụng.`,
    smsFallback: false,
  },
};

export function templateFor(kind: NotificationKind): NotificationTemplate {
  return { kind, ...TEMPLATES[kind] };
}

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** Nội dung SMS thay thế (ngắn, không PII). */
export function smsTextFor(template: NotificationTemplate): string {
  return `Tam Giao: ${template.title}. ${template.body}`;
}

/** Cài đặt nhận thông báo của người dùng (chỉ các nhóm tắt được). Chưa cài đặt = bật hết. */
export interface NotificationPreferences {
  readonly matches: boolean;
  readonly messages: boolean;
  readonly dates: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  matches: true,
  messages: true,
  dates: true,
};

/** Người dùng có nhận thông báo thuộc `category` không (nhóm luôn bật bỏ qua cài đặt). */
export function isCategoryEnabled(category: NotificationCategory, prefs: NotificationPreferences): boolean {
  switch (category) {
    case 'MATCH':
      return prefs.matches;
    case 'MESSAGE':
      return prefs.messages;
    case 'DATE':
      return prefs.dates;
    case 'ACCOUNT':
    case 'SAFETY':
      return true;
  }
}

const HOUR_MS = 3_600_000;

/** Thời điểm nhắc trước `deadline` `hours` giờ; `null` nếu mốc đó không còn ở sau `now` (nhắc vô nghĩa). */
export function reminderTime(deadline: Date, hours: number, now: Date): Date | null {
  const at = new Date(deadline.getTime() - hours * HOUR_MS);
  return at.getTime() > now.getTime() ? at : null;
}

/** Loại thông báo nhắc giai đoạn tìm hiểu (BE-S7-04) — huỷ cùng nhau khi match rời `DATING`. */
export const DATING_REMINDER_KINDS = [
  'DATING_REMINDER_FIRST',
  'DATING_REMINDER_FINAL',
] as const satisfies readonly NotificationKind[];

/** Mốc nhắc giai đoạn tìm hiểu: ngày thứ N kể từ lúc bắt đầu DATING; bỏ mốc không còn trước hạn `expiresAt`. */
export function datingReminderTimes(
  startedAt: Date,
  expiresAt: Date,
): { readonly kind: NotificationKind; readonly at: Date }[] {
  const candidates = [
    {
      kind: 'DATING_REMINDER_FIRST' as const,
      at: addDuration(startedAt, { days: DATING_FIRST_REMINDER_DAY }),
    },
    {
      kind: 'DATING_REMINDER_FINAL' as const,
      at: addDuration(startedAt, { days: DATING_FINAL_REMINDER_DAY }),
    },
  ];
  return candidates.filter((item) => item.at.getTime() < expiresAt.getTime());
}
