/**
 * Văn bản tiếng Việt cho phân hệ Quyền dữ liệu cá nhân (FE-S2-06).
 * Tuân thủ quy ước: F6 (văn bản tập trung trong copy.ts, không rải chuỗi trong component).
 * Tuân thủ FE-D5: không nhắc "VNeID", "Bộ Công An", "ký quỹ", "bảo chứng".
 * Quyết định PO: nêu rõ "không hoàn phí xác thực" khi xoá tài khoản.
 */
export const DATA_RIGHTS_COPY = {
  headerTitle: 'Quyền dữ liệu cá nhân',
  backButton: '← Quay lại',
  legalNotice:
    'Theo Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân, bạn có quyền yêu cầu trích xuất dữ liệu hoặc yêu cầu xoá toàn bộ dữ liệu cá nhân khỏi hệ thống Tâm Giao.',

  export: {
    cardTitle: 'Xuất dữ liệu cá nhân',
    description:
      'Tải về tệp dữ liệu cá nhân của bạn được lưu trữ trên hệ thống Tâm Giao (hồ sơ, hình ảnh, tiêu chí và tương tác).',
    requestButton: 'Yêu cầu xuất dữ liệu',
    requesting: 'Đang gửi yêu cầu...',
    pendingTitle: 'Đang khởi tạo file dữ liệu',
    pendingDesc: 'Hệ thống đang tổng hợp dữ liệu cá nhân của bạn. Trạng thái sẽ được kiểm tra tự động.',
    readyTitle: 'File dữ liệu đã sẵn sàng',
    readyDesc: 'Bản sao dữ liệu cá nhân của bạn đã được đóng gói hoàn tất. Bạn có thể tải về máy.',
    downloadButton: 'Tải file dữ liệu (.json)',
    expiryNotice: 'Liên kết tải xuống có hiệu lực trong vòng 24 giờ kể từ khi sẵn sàng.',
    expiredTitle: 'Liên kết tải dữ liệu đã hết hạn',
    expiredDesc:
      'Liên kết tải về trước đây đã quá thời hạn 24 giờ quy định. Bạn có thể bấm bên dưới để yêu cầu xuất lại tệp mới.',
    retryButton: 'Yêu cầu xuất lại',
  },

  deleteAccount: {
    cardTitle: 'Xoá tài khoản',
    cardDesc:
      'Yêu cầu xoá vĩnh viễn tài khoản và ẩn danh toàn bộ dữ liệu cá nhân liên quan khỏi hệ thống Tâm Giao.',
    startDeletionButton: 'Yêu cầu xoá tài khoản',

    // Bước 1: Cảnh báo hệ quả
    warningHeader: 'Cảnh báo trước khi xoá tài khoản',
    warningSubheader: 'Thao tác xoá tài khoản mang tính vĩnh viễn và không thể hoàn tác. Xin lưu ý:',
    consequences: [
      'Mọi gợi ý ghép đôi và cuộc trò chuyện hiện tại sẽ bị đóng ngay lập tức.',
      'Dữ liệu hồ sơ, ảnh và thông tin cá nhân sẽ bị xoá hoặc ẩn danh vĩnh viễn theo Nghị định 13/2023/NĐ-CP.',
      'Khoản thu phí xác thực tài khoản sẽ không hoàn phí xác thực trong mọi trường hợp khi bạn chủ động xoá tài khoản.',
    ],
    noRefundNotice: 'Lưu ý: Không hoàn phí xác thực khi người dùng chủ động yêu cầu xoá tài khoản.',
    confirmCheckbox: 'Tôi đã hiểu rõ các hệ quả trên và đồng ý không hoàn phí xác thực khi xoá tài khoản.',
    proceedToOtpButton: 'Tiếp tục nhận mã OTP',
    cancelButton: 'Huỷ bỏ',

    // Bước 2: Nhập OTP
    otpHeader: 'Xác thực xoá tài khoản',
    otpSubheader: 'Mã xác thực OTP gồm 6 chữ số đã được gửi đến số điện thoại của bạn để xác nhận lần cuối.',
    otpInputLabel: 'Mã xác thực OTP gồm 6 chữ số',
    confirmDeleteButton: 'Xác nhận xoá vĩnh viễn',
    verifyingOtp: 'Đang xác thực xoá...',
    backToWarning: 'Quay lại cảnh báo',

    // Bước 3: Tiến độ xoá
    progressHeader: 'Tiến độ xoá tài khoản',
    progressSubheader:
      'Yêu cầu xoá tài khoản của bạn đang được xử lý theo từng bước quy định bảo vệ dữ liệu:',
    statusProcessing: 'Đang xử lý xoá',
    statusCompleted: 'Đã hoàn tất xoá',
    stepPending: 'Đang xử lý',
    stepDone: 'Đã hoàn tất',
    sessionRevokedNote:
      'Phiên đăng nhập của bạn đã được thu hồi an toàn. Bạn có thể trở về màn hình đăng nhập bất cứ lúc nào.',
    returnToLoginButton: 'Về màn hình đăng nhập',
  },
} as const;
