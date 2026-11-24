import type { ReportCategoryName } from '@tamgiao/contracts/safety';

export const REPORT_CATEGORIES_COPY = {
  MARITAL_FRAUD: {
    label: 'Gian dối tình trạng hôn nhân',
    description:
      'Đã kết hôn nhưng khai báo độc thân, làm giả giấy tờ tình trạng hôn nhân hoặc mạo danh danh tính.',
  },
  FINANCIAL_SCAM: {
    label: 'Gạ gẫm chuyển tiền / Đầu tư tài chính',
    description: 'Dụ dỗ tham gia sàn giao dịch, kêu gọi góp vốn, mượn tiền khẩn cấp hoặc gửi đường link lạ.',
  },
  HARASSMENT: {
    label: 'Quấy rối / Hành vi khiếm nhã',
    description:
      'Sử dụng ngôn từ thô tục, ép buộc tiếp xúc ngoài đời thực hoặc gửi hình ảnh nhạy cảm không mong muốn.',
  },
  NO_SHOW_DISRESPECT: {
    label: 'Hủy hẹn vô cớ / Bất lịch sự nghiêm trọng',
    description:
      'Không đến điểm hẹn đã thống nhất mà không báo trước, có thái độ thiếu tôn trọng đối phương.',
  },
} as const satisfies Record<ReportCategoryName, { label: string; description: string }>;

export const SAFETY_CENTER_COPY = {
  header: {
    title: 'Trung tâm an toàn',
    back: 'Quay lại',
    backIcon: '←',
  },
  trustBanner: {
    title: 'Trung tâm bảo vệ an toàn',
    description:
      'Bảo vệ danh tính và an toàn của bạn. Đội ngũ chuyên viên tiếp nhận và xử lý nghiêm túc mọi phản ánh.',
    secureNotice: 'Mọi thông tin phản ánh được lưu trữ bảo mật và xử lý độc lập.',
  },
  guidelines: {
    title: 'Nguyên tắc an toàn cần nhớ',
    item1:
      'Tuyệt đối không chuyển tiền, nạp tiền đầu tư hoặc cung cấp thông tin tài chính dưới mọi hình thức.',
    item2: 'Không cung cấp mã xác thực OTP, mật khẩu tài khoản cho bất kỳ ai.',
    item3: 'Báo cáo ngay khi nhận thấy dấu hiệu bất thường hoặc hành vi khiếm nhã.',
  },
  action: {
    currentMatchTitle: 'Đối tượng ghép đôi hiện tại',
    nameAge: (name: string, age: number) => `${name}, ${age}`,
    reportButton: (name: string) => `Báo cáo ${name}`,
    noMatchTitle: 'Hướng dẫn an toàn khi làm quen',
    noMatchDescription:
      'Bạn hiện chưa trong giai đoạn tìm hiểu với ai. Nếu gặp hành vi nghi vấn trong quá trình trải nghiệm, bạn có thể báo cáo từ cuộc trò chuyện tương ứng trong hộp thư.',
  },
  notification: {
    reportUpdated: 'Chuyên viên đã cập nhật báo cáo của bạn',
  },
} as const;

export const REPORT_COPY = {
  header: {
    title: 'Báo cáo vi phạm',
    back: 'Quay lại',
    backIcon: '←',
  },
  reportedTarget: {
    title: 'Đối tượng được báo cáo',
    nameAge: (name: string, age: number) => `${name}, ${age}`,
    reportedFallback: 'Người tìm hiểu cùng bạn',
  },
  categorySection: {
    title: 'Chọn hành vi vi phạm',
    requiredNotice: '* Bắt buộc',
    subtitle:
      'Hệ thống áp dụng biện pháp xử lý nghiêm khắc đối với các hành vi xâm phạm sự chân thực và an toàn.',
  },
  descriptionSection: {
    title: 'Mô tả diễn biến cụ thể',
    placeholder:
      'Xin hãy chia sẻ chi tiết tình huống, thời gian và biểu hiện khiến bạn cảm thấy không an toàn...',
    counter: (current: number, max: number) => `${current} / ${max}`,
  },
  evidenceSection: {
    title: (max: number) => `Bằng chứng xác thực (Tối đa ${max} ảnh)`,
    recommendation: 'Khuyên dùng',
    addPhoto: 'Thêm ảnh',
    removePhoto: (index: number) => `Xoá ảnh ${index + 1}`,
    retry: 'Thử lại',
    failedNotice: 'Ảnh tải lỗi sẽ không được gửi kèm. Vui lòng thử lại hoặc xoá ảnh đó.',
    subtitle: 'Ảnh chụp tin nhắn hoặc tài liệu sẽ chỉ được xem xét bởi bộ phận kiểm duyệt.',
  },
  urgentSection: {
    title: 'Chuyên viên can thiệp khẩn cấp',
    slaBadge: (minutes: number) => `${minutes} phút`,
    description: (minutes: number) =>
      `Chuyên viên sẽ ưu tiên tiếp nhận và xử lý hỗ trợ trong vòng ${minutes} phút.`,
  },
  submitButton: 'Gửi báo cáo & kích hoạt bảo vệ',
  cancelButton: 'Huỷ bỏ và quay lại',
  confirmModal: {
    title: 'Xác nhận gửi báo cáo',
    description:
      'Sau khi gửi báo cáo, kết nối ghép đôi sẽ tạm thời bị khoá và cuộc trò chuyện sẽ chuyển sang chế độ chỉ đọc để đảm bảo an toàn cho bạn trong thời gian chuyên viên xem xét.',
    confirmButton: 'Xác nhận gửi',
    cancelButton: 'Xem lại',
  },
  sent: {
    title: 'Báo cáo đã được ghi nhận',
    description: 'Kết nối ghép đôi đã tạm khoá và cuộc trò chuyện được chuyển sang chế độ chỉ đọc.',
    urgentTitle: 'Xử lý khẩn cấp',
    normalTitle: 'Đang tiến hành xử lý',
    urgentNotice: (minutes: number) =>
      `Báo cáo khẩn cấp: chuyên viên sẽ phản hồi trong vòng ${minutes} phút.`,
    normalNotice: 'Chuyên viên kiểm duyệt sẽ xem xét báo cáo và tiến hành xử lý theo quy định.',
    backHome: 'Về trang chính',
  },
  errors: {
    generic: 'Có lỗi xảy ra khi gửi báo cáo. Vui lòng thử lại sau.',
    photoAccess: 'Không mở được thư viện ảnh. Vui lòng kiểm tra quyền truy cập ảnh trong cài đặt máy.',
  },
} as const;
