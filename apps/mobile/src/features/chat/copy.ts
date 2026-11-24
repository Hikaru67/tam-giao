export const CHAT_COPY = {
  header: {
    back: 'Quay lại',
    peerFallback: 'Người tìm hiểu cùng bạn',
    backIcon: '←',
    nameAge: (name: string, age: number) => `${name}, ${age}`,
    report: 'Báo cáo vi phạm',
  },
  progress: {
    day: (day: number, total: number) => `Ngày ${day}/${total}`,
    remaining: (days: number) => `Còn ${days} ngày trò chuyện`,
  },
  safety: {
    body: 'Tuyệt đối không chuyển tiền, đầu tư tài chính hoặc cung cấp OTP/mật khẩu cá nhân.',
  },
  connection: {
    reconnecting: 'Đang kết nối lại…',
    signedOut: 'Phiên đăng nhập đã hết',
  },
  bubble: {
    you: 'Bạn',
    sending: 'Đang gửi',
    read: 'Đã đọc',
    retry: 'Gửi lại',
    discard: 'Xoá',
    maskedNotice: 'Một phần nội dung đã được ẩn để bảo vệ bạn',
    unsupported: 'Định dạng tin nhắn chưa được hỗ trợ',
  },
  composer: {
    placeholderWithName: (name: string) => `Nhắn tin chân thành tới ${name}...`,
    placeholder: 'Nhắn tin chân thành...',
    send: 'Gửi',
  },
  readonly: {
    title: 'Cuộc trò chuyện đã khép lại',
    description: 'Giai đoạn tìm hiểu đã kết thúc hoặc cuộc trò chuyện đã đóng.',
  },
  empty: {
    title: 'Không tìm thấy cuộc trò chuyện',
    description: 'Cuộc trò chuyện này không tồn tại hoặc bạn không có quyền truy cập.',
    backHome: 'Về trang chủ',
  },
  loading: 'Đang tải tin nhắn...',
  genericError: 'Có lỗi xảy ra. Vui lòng thử lại sau.',
} as const;
