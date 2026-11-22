/**
 * Văn bản hiển thị cho màn hình cài đặt thông báo (tuân thủ luật F6).
 * Tuân thủ FE-D5: không nhắc "VNeID", "Bộ Công An", "ký quỹ", "bảo chứng".
 */
export const NOTIFICATIONS_COPY = {
  settings: {
    headerTitle: 'Cài đặt thông báo',
    title: 'Tùy chọn nhận thông báo',
    description: 'Quản lý các loại thông báo đẩy bạn muốn nhận trên thiết bị này.',
    sectionInteractive: 'Thông báo tương tác',
    sectionMandatory: 'Thông báo bắt buộc',
    categories: {
      MATCH: {
        title: 'Gợi ý ghép đôi',
        description: 'Nhận thông báo khi có gợi ý người phù hợp mới và nhắc nhở thời hạn phản hồi.',
      },
      MESSAGE: {
        title: 'Tin nhắn trò chuyện',
        description: 'Nhận thông báo khi đối phương gửi tin nhắn mới trong cuộc trò chuyện.',
      },
      DATE: {
        title: 'Lịch hẹn gặp mặt',
        description: 'Nhận thông báo về lời mời hẹn, xác nhận lịch và nhắc nhở trước giờ gặp.',
      },
      ACCOUNT: {
        title: 'Tài khoản & Xác thực',
        description: 'Cập nhật tiến trình xét duyệt hồ sơ và hoàn phí xác thực. Luôn bật để đảm bảo dịch vụ.',
        badge: 'Bắt buộc',
      },
      SAFETY: {
        title: 'An toàn & Báo cáo',
        description: 'Thông báo xử lý báo cáo vi phạm và cảnh báo an toàn. Luôn bật để bảo vệ bạn.',
        badge: 'Bắt buộc',
      },
    },
    errorTitle: 'Không thể tải cài đặt',
    retry: 'Thử lại',
    saveError: 'Không thể cập nhật cài đặt thông báo. Vui lòng thử lại.',
  },
} as const;
