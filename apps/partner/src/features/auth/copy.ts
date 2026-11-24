export const PARTNER_APP_COPY = {
  brandName: 'Tâm Giao',
  partnerPortal: 'Quán đối tác',
} as const;

export const LOGIN_COPY = {
  brandName: 'Tâm Giao',
  badge: 'Đối tác',
  headerSubtitle: 'Cổng xác thực voucher dành cho quán đối tác',
  title: 'Đăng nhập nhân viên',
  description: 'Nhập mã định danh nhân viên và mã PIN 6 số để bắt đầu ca làm việc.',
  staffIdLabel: 'Mã nhân viên',
  staffIdPlaceholder: 'Nhập mã UUID nhân viên (vd: 01890a5d-...)',
  rememberedStaffNotice: 'Nhân viên đã ghi nhớ trên thiết bị này',
  changeStaffId: 'Đổi mã nhân viên',
  pinLabel: 'Mã PIN',
  pinHint: 'Nhập đúng 6 chữ số bí mật của bạn',
  submit: 'Đăng nhập',
  submitting: 'Đang đăng nhập…',
  deviceIdLabel: 'Mã thiết bị',
  footerNotice: 'Mã nhân viên và thiết bị được bảo mật theo quy định.',
  errors: {
    staffIdRequired: 'Vui lòng nhập mã nhân viên.',
    staffIdInvalid: 'Mã nhân viên phải là định dạng UUID hợp lệ.',
    pinRequired: 'Vui lòng nhập mã PIN.',
    pinInvalid: 'Mã PIN phải bao gồm đúng 6 chữ số.',
  },
  lockedMinutesSuffix: 'phút',
  lockedNotice: (minutes: number) => `Tài khoản tạm bị khoá. Vui lòng thử lại sau ${minutes} phút.`,
} as const;

export const SCAN_COPY = {
  header: {
    partnerLabel: 'Quán',
    staffLabel: 'Nhân viên',
    logout: 'Đăng xuất',
  },
  scanner: {
    title: 'Quét mã QR voucher',
    instruction: 'Hướng camera về phía mã QR trên ứng dụng của khách hàng',
    manualInputPrompt: 'Camera gặp sự cố hoặc không thể quét?',
    openManualInput: 'Nhập mã thủ công',
    starting: 'Đang khởi động camera…',
    denied:
      'Ứng dụng chưa được cấp quyền truy cập camera. Vui lòng cấp quyền trong cài đặt trình duyệt hoặc sử dụng tính năng nhập mã thủ công bên dưới.',
    unavailable: 'Không tìm thấy thiết bị camera trên máy này. Vui lòng chuyển sang chế độ nhập mã thủ công.',
    error: 'Đã xảy ra lỗi khi truy cập camera. Vui lòng thử lại hoặc nhập mã thủ công.',
    retryCamera: 'Thử lại camera',
  },
  manualInput: {
    title: 'Nhập mã voucher thủ công',
    description: 'Dán hoặc nhập chuỗi ký tự mã voucher từ màn hình khách hàng',
    tokenLabel: 'Chuỗi mã voucher',
    tokenPlaceholder: 'Nhập mã token…',
    submit: 'Xác nhận đổi voucher',
    submitting: 'Đang kiểm tra voucher…',
    cancel: 'Quay lại quét camera',
    emptyError: 'Vui lòng nhập chuỗi mã voucher.',
  },
  outcomes: {
    success: {
      title: 'Đổi voucher thành công',
      label: 'Giá trị voucher',
    },
    alreadyRedeemed: {
      title: 'Voucher đã được sử dụng',
      description: 'Mỗi voucher chỉ có giá trị đổi một lần duy nhất tại quán đối tác.',
    },
    possiblePriorSuccess: 'Có thể lần gửi trước đã thành công — kiểm tra với khách trước khi từ chối.',
    expired: {
      title: 'Voucher đã hết hạn',
      description: 'Voucher này đã quá hạn sử dụng và không thể áp dụng.',
    },
    wrongPartner: {
      title: 'Voucher không áp dụng tại quán này',
      description: 'Voucher này được chỉ định cho một địa điểm quán đối tác khác.',
    },
    invalidCode: {
      title: 'Mã QR voucher không hợp lệ hoặc đã hết hạn',
      description: 'Không tìm thấy thông tin voucher hoặc mã QR đã bị thay đổi/hết hạn.',
    },
    notActive: {
      title: 'Voucher chưa được kích hoạt hoặc đã bị huỷ',
      description: 'Khách hàng cần hoàn tất các điều kiện của chương trình để kích hoạt voucher.',
    },
    network: {
      title: 'Lỗi kết nối mạng',
      description: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền và thử lại.',
    },
    unknown: {
      title: 'Không thể xử lý voucher',
      description: 'Đã xảy ra lỗi không xác định. Vui lòng liên hệ quản lý hoặc thử lại sau.',
    },
    inactivePartner: {
      title: 'Quán hoặc tài khoản nhân viên không còn hoạt động',
      description: 'Tài khoản của quán hoặc nhân viên đã bị tạm ngưng. Vui lòng liên hệ quản trị hệ thống.',
      logoutAction: 'Đăng xuất',
    },
  },
  actions: {
    nextScan: 'Quét mã tiếp',
    retry: 'Thử lại',
    close: 'Đóng',
  },
  formatVnd: (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)} đ`,
} as const;
