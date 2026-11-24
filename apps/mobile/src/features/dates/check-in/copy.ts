import { CHECK_IN_LOCATION_RETENTION_HOURS, CHECK_IN_OVERDUE_MINUTES } from '@tamgiao/contracts/constants';
import type { CHECK_IN_SOURCE_NAMES } from '@tamgiao/contracts/dating';

export const CHECK_IN_COPY = {
  cardTitle: 'Check-in an toàn',
  confirmedNotice: (start: string, end: string) => `Check-in mở trong khung giờ hẹn (${start} - ${end})`,
  shareLocationLabel: 'Gửi vị trí một lần cho chuyên viên',
  shareLocationHint: `Chỉ gửi một lần, tự xoá sau ${CHECK_IN_LOCATION_RETENTION_HOURS} giờ.`,
  checkedInAt: (time: string) => `Đã check-in lúc ${time}`,
  checkedOutAt: (time: string) => `Đã check-out lúc ${time}`,
  locationSharedBadge: 'Đã gửi vị trí',
  sources: {
    MANUAL: 'Tự check-in',
    VOUCHER: 'Quán quét voucher',
  } as const satisfies Record<(typeof CHECK_IN_SOURCE_NAMES)[number], string>,
  actions: {
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    retry: 'Thử lại',
  },
  overdueHint: `Vui lòng check-out sau buổi hẹn. Quá ${CHECK_IN_OVERDUE_MINUTES} phút sau giờ kết thúc, chuyên viên sẽ được cảnh báo để hỗ trợ an toàn.`,
  toasts: {
    successWithLocation: 'Check-in thành công',
    successWithoutLocation: 'Đã check-in, không gửi vị trí',
    checkOutSuccess: 'Đã check-out thành công',
  },
  errors: {
    loadFailed: 'Không thể tải thông tin check-in',
  },
} as const;
