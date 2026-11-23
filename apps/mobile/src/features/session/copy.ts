/**
 * Văn bản hiển thị tiếng Việt dùng chung cho các màn và hook liên quan đến phiên làm việc (FE-S2-02).
 * Tuân thủ quy ước: F6 (không rải chuỗi trong component).
 */
export const SESSION_COPY = {
  brandName: 'Tâm Giao',
  placeholderScreen: {
    building: (taskId: string) => `Đang xây dựng (${taskId})`,
    logoutButton: 'Đăng xuất',
  },
  screens: {
    profile: {
      title: 'Khởi tạo hồ sơ',
      taskId: 'FE-S2-03',
    },
    preferences: {
      title: 'Tiêu chí bạn đời',
      taskId: 'FE-S2-04',
    },
    verificationStatus: {
      title: 'Hồ sơ đang thẩm định',
      taskId: 'FE-S3-04',
    },
    home: {
      title: 'Gợi ý ghép đôi',
      taskId: 'FE-S4-01',
    },
    settings: {
      title: 'Cài đặt',
      taskId: 'FE-S2-05',
    },
  },
  entryScreen: {
    loading: 'Đang tải thông tin...',
    retry: 'Thử lại',
  },
  sessions: {
    title: 'Thiết bị đăng nhập',
  },
} as const;
