/**
 * Bản sao văn bản tiếng Việt cho phân hệ Cài đặt & Quản lý thiết bị (FE-S2-06).
 * Tuân thủ quy ước: F6 (văn bản tập trung trong copy.ts, không rải chuỗi trong component).
 * Tuân thủ FE-D5: không nhắc "VNeID", "Bộ Công An", "ký quỹ", "bảo chứng".
 */
export const SETTINGS_COPY = {
  headerTitle: 'Cài đặt',
  sections: {
    general: 'Tài khoản & Thiết bị',
    privacy: 'Quyền riêng tư & Dữ liệu',
  },
  items: {
    notifications: {
      title: 'Cài đặt thông báo',
      subtitle: 'Quản lý thông báo gợi ý ghép đôi, tin nhắn và lịch hẹn',
      badge: 'Tuỳ chỉnh',
    },
    sessions: {
      title: 'Thiết bị đăng nhập',
      subtitle: 'Xem và quản lý các thiết bị đang đăng nhập tài khoản',
    },
    account: {
      title: 'Quyền dữ liệu cá nhân',
      subtitle: 'Xuất dữ liệu cá nhân và yêu cầu xoá tài khoản',
    },
  },
  logout: {
    button: 'Đăng xuất',
    confirmTitle: 'Đăng xuất',
    confirmMessage: 'Bạn có chắc chắn muốn đăng xuất khỏi tài khoản?',
    confirmAction: 'Đăng xuất',
    cancelAction: 'Huỷ',
  },
  sessionsScreen: {
    headerTitle: 'Thiết bị đăng nhập',
    title: 'Danh sách thiết bị',
    description: 'Các thiết bị đang duy trì phiên đăng nhập vào tài khoản Tâm Giao của bạn.',
    currentDeviceBadge: 'Thiết bị này',
    unknownDevice: 'Thiết bị không xác định',
    lastActive: (time: string) => `Hoạt động gần nhất: ${time}`,
    revokeButton: 'Thu hồi',
    revokeA11yLabel: (device: string) => `Thu hồi phiên đăng nhập ${device}`,
    revokeModal: {
      title: 'Thu hồi phiên đăng nhập',
      message: (device: string) =>
        `Bạn có chắc chắn muốn đăng xuất thiết bị "${device}" khỏi tài khoản của bạn?`,
      confirmAction: 'Xác nhận thu hồi',
      cancelAction: 'Huỷ bỏ',
    },
    emptyList: 'Chưa ghi nhận thiết bị nào khác.',
    loading: 'Đang tải danh sách thiết bị...',
    error: 'Không thể tải danh sách thiết bị. Vui lòng thử lại sau.',
    retryButton: 'Thử lại',
    backButton: '← Quay lại',
  },
} as const;
