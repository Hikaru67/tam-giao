export const INBOX_COPY = {
  header: {
    title: 'Trò chuyện & Hẹn hò',
    back: 'Quay lại',
    backIcon: '←',
  },
  loading: 'Đang tải danh sách trò chuyện...',
  genericError: 'Có lỗi xảy ra. Vui lòng thử lại sau.',
  retry: 'Thử lại',
  empty: {
    title: 'Chưa có cuộc trò chuyện nào',
    description: 'Khi bạn và đối phương cùng đồng ý kết nối, cuộc trò chuyện sẽ xuất hiện tại đây.',
  },
  sections: {
    open: 'Đang tìm hiểu',
    closed: 'Đã kết thúc',
  },
  peerFallback: 'Người tìm hiểu cùng bạn',
  youPrefix: 'Bạn: ',
  noMessage: 'Chưa có tin nhắn',
  dayMilestone: (day: number, total: number) => `Ngày ${day}/${total}`,
  scheduleDate: 'Đặt lịch gặp',
} as const;
