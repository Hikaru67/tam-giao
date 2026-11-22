/**
 * Văn bản tiếng Việt cho màn đặt lịch phỏng vấn sơ bộ (FE-S3-03). F6: toàn bộ chữ đặt ở đây.
 * Chưa có thiết kế (FE-D4). Gọi video ngoài phạm vi: không hiển thị link phòng họp.
 */
export const INTERVIEW_COPY = {
  header: {
    title: 'Phỏng vấn sơ bộ',
    back: 'Quay lại',
  },
  loading: 'Đang tải lịch phỏng vấn...',
  genericError: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
  intro: {
    title: (minutes: number) => `Trò chuyện ${minutes} phút với chuyên viên`,
    body: 'Buổi phỏng vấn ngắn giúp chuyên viên hiểu thêm về bạn trước khi duyệt hồ sơ. Chọn khung giờ thuận tiện nhất.',
  },
  picker: {
    title: 'Chọn khung giờ',
    rescheduleTitle: 'Chọn khung giờ mới',
    timezoneHint: 'Giờ hiển thị theo múi giờ trên điện thoại của bạn.',
    dayLabel: (weekday: string, date: string) => `${weekday}, ${date}`,
    weekdays: ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'],
    slotLabel: (start: string, end: string) => `${start} – ${end}`,
    empty: {
      title: 'Chưa có khung giờ trống',
      description: 'Chuyên viên sẽ mở thêm lịch sớm. Vui lòng quay lại sau.',
    },
    refresh: 'Làm mới',
  },
  booking: {
    title: 'Lịch phỏng vấn của bạn',
    badge: 'Đã đặt lịch',
    when: (date: string, start: string, end: string) => `${date} · ${start} – ${end}`,
    changeHint: (hours: number, deadlineTime: string, deadlineDate: string) =>
      `Bạn có thể huỷ hoặc đổi lịch trước ${deadlineTime} ngày ${deadlineDate} (${hours} giờ trước giờ bắt đầu).`,
    lockedHint: (hours: number) =>
      `Đã quá hạn huỷ/đổi lịch: chỉ được thay đổi khi còn ít nhất ${hours} giờ trước giờ phỏng vấn. Vui lòng tham gia đúng giờ.`,
  },
  cta: {
    book: 'Xác nhận đặt lịch',
    selectFirst: 'Chọn một khung giờ',
    reschedule: 'Đổi lịch',
    confirmReschedule: 'Xác nhận đổi lịch',
    cancelReschedule: 'Giữ lịch hiện tại',
    cancel: 'Huỷ lịch',
  },
  cancelSheet: {
    title: 'Huỷ lịch phỏng vấn?',
    body: 'Khung giờ sẽ được nhả cho người khác. Bạn có thể đặt lại khung giờ khác sau.',
    confirm: 'Huỷ lịch',
    keep: 'Giữ lịch',
  },
  toast: {
    booked: 'Đã đặt lịch phỏng vấn.',
    rescheduled: 'Đã đổi lịch phỏng vấn.',
    cancelled: 'Đã huỷ lịch phỏng vấn.',
    slotTaken: 'Khung giờ vừa có người đặt. Danh sách đã được làm mới, vui lòng chọn khung giờ khác.',
  },
  entry: {
    title: 'Phỏng vấn sơ bộ',
    notBooked: 'Đặt lịch trò chuyện ngắn với chuyên viên để hoàn tất thẩm định.',
    booked: (date: string, start: string) => `Đã hẹn lúc ${start} ngày ${date}.`,
    bookCta: 'Đặt lịch phỏng vấn',
    viewCta: 'Xem lịch phỏng vấn',
  },
} as const;
