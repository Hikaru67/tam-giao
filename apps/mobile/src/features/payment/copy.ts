/**
 * Văn bản hiển thị tiếng Việt cho tính năng thanh toán xác thực (FE-S3-01).
 * Tuân thủ F6: toàn bộ văn bản đặt trong file nội dung, không rải trong component.
 * Chữ trung tính "phí xác thực" theo FE-D5; tuyệt đối không có "ký quỹ", "bảo chứng",
 * "VNeID", "Bộ Công An", "Napas", "MoMo".
 */
export const PAYMENT_COPY = {
  header: {
    title: 'Xác thực hồ sơ',
    back: 'Quay lại',
  },
  progress: {
    stepBadge: 'Bước 3/3',
    steps: {
      profile: 'Hồ sơ',
      preferences: 'Tiêu chuẩn',
      verification: 'Xác thực',
    },
  },
  fee: {
    label: 'Phí xác thực một lần',
    description: 'Thanh toán một lần để chuyên viên thẩm định hồ sơ của bạn.',
  },
  voucher: {
    title: (amount: string) => `Tặng voucher hẹn hò ${amount}`,
    body: 'Dùng tại quán đối tác an toàn trong buổi gặp đầu tiên. Voucher kích hoạt khi hồ sơ được duyệt.',
  },
  refund: {
    title: 'Cam kết hoàn tiền',
    body: (hours: number, amount: string) =>
      `Nếu hồ sơ không được duyệt, Tâm Giao hoàn lại ${amount} phí xác thực trong vòng ${hours} giờ.`,
  },
  cta: {
    pay: (amount: string) => `Thanh toán ${amount}`,
    retry: 'Thử thanh toán lại',
    resume: 'Tiếp tục thanh toán',
    checkAgain: 'Kiểm tra lại',
  },
  status: {
    polling: 'Đang kiểm tra giao dịch thanh toán...',
    pollingHint: 'Bạn có thể đóng trình duyệt, app sẽ tự cập nhật.',
    succeeded: 'Đã thanh toán phí xác thực thành công.',
    refundPending: 'Khoản phí đang được xử lý hoàn tiền.',
    refunded: 'Khoản phí đã được hoàn lại.',
    failed: 'Giao dịch thanh toán chưa thành công.',
    timeout: 'Chưa nhận được kết quả từ cổng thanh toán.',
    nextStep: 'Hồ sơ của bạn đã sẵn sàng cho bước nộp eKYC tiếp theo.',
  },
  loading: 'Đang tải thông tin thanh toán...',
  genericError: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
  dev: {
    title: 'Công cụ dev: cổng thanh toán giả',
    succeed: 'Thanh toán giả: thành công',
    fail: 'Thanh toán giả: thất bại',
  },
} as const;
