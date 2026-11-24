import type { VoucherStatusDto } from '@tamgiao/contracts/billing';
import type { BadgeTone } from '@tamgiao/ui-mobile';

export const VOUCHER_STATUS_LABELS = {
  RESERVED: 'Đã giữ chỗ',
  ACTIVE: 'Sẵn sàng sử dụng',
  REDEEMED: 'Đã sử dụng',
  VOID: 'Đã huỷ',
  EXPIRED: 'Đã hết hạn',
} as const satisfies Record<VoucherStatusDto, string>;

export const VOUCHER_STATUS_TONES = {
  RESERVED: 'warning',
  ACTIVE: 'success',
  REDEEMED: 'neutral',
  VOID: 'danger',
  EXPIRED: 'neutral',
} as const satisfies Record<VoucherStatusDto, BadgeTone>;

export const VOUCHERS_COPY = {
  header: {
    title: 'Voucher của bạn',
    back: 'Quay lại',
    backIcon: '‹',
  },
  loading: 'Đang tải danh sách voucher...',
  empty: {
    title: 'Chưa có voucher',
    description: 'Voucher hẹn hò sẽ xuất hiện tại đây khi hồ sơ của bạn được phê duyệt.',
  },
  status: VOUCHER_STATUS_LABELS,
  partner: {
    any: 'Quán đối tác bất kỳ',
    assigned: 'Quán đối tác được chỉ định',
  },
  expiry: {
    until: (date: string) => `Hạn dùng đến ${date}`,
    redeemedAt: (date: string) => `Đã dùng ngày ${date}`,
    noExpiry: 'Hạn dùng tính từ khi hồ sơ được duyệt',
  },
  reservedHint: 'Kích hoạt khi lịch hẹn được xác nhận.',
  actions: {
    showQr: 'Hiện mã QR',
    hideQr: 'Ẩn mã QR',
    retry: 'Thử lại',
    entryButton: 'Voucher của bạn',
  },
  qrInstructions: 'Đưa mã QR này cho nhân viên quán đối tác khi thanh toán.',
  qrAccessibilityLabel: 'Mã QR voucher',
  qrRefreshing: 'Đang làm mới mã QR...',
  redeemedBanner: 'Voucher đã được sử dụng',
} as const;
