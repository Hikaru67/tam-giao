/**
 * Văn bản hiển thị cho toàn bộ luồng xác thực SĐT và OTP (tuân thủ luật F6).
 * Tuân thủ FE-D5: không hiển thị VNeID, Bộ Công An, ký quỹ, bảo chứng 100%.
 */
export const AUTH_COPY = {
  brand: {
    name: 'TÂM GIAO',
    tagline: 'Tiền Hôn Nhân',
    quote: '"Một người thật, một lúc, một cam kết."',
  },
  phoneScreen: {
    headerTitle: 'Đăng Nhập & Đăng Ký',
    pitchTitle: 'Bắt đầu hành trình tìm kiếm người bạn đời đích thực',
    pitchDescription:
      'Tâm Giao là cộng đồng tiền hôn nhân nghiêm túc, xác thực danh tính và bảo vệ dữ liệu cá nhân theo Nghị định 13/2023/NĐ-CP.',
    ekycBadge: 'Xác thực danh tính bằng CCCD',
    encryptionBadge: 'Mã hóa đa tầng',
    phoneLabel: 'Số điện thoại di động',
    phonePlaceholder: '0912 345 678',
    phoneHint: 'Nhập số điện thoại di động Việt Nam của bạn',
    submitButton: 'Tiếp tục nhận mã OTP',
  },
  otpScreen: {
    headerTitle: 'Xác Thực Số Điện Thoại & OTP',
    title: 'Xác thực số điện thoại',
    description: 'Mã xác thực gồm 6 chữ số đã được gửi qua tin nhắn SMS tới số',
    statusHint: 'Mã OTP chỉ dùng một lần và hết hạn sau ít phút.',
    instruction: 'Nhập mã gồm 6 chữ số',
    resendPrefix: 'Gửi lại mã OTP sau',
    resendButton: 'Gửi lại mã',
    editPhoneA11y: 'Đổi số điện thoại',
    safetyTitle: 'Lưu ý an toàn',
    safetyContent:
      'Nhân viên và tư vấn viên Tâm Giao tuyệt đối không bao giờ yêu cầu bạn cung cấp mã OTP này. Không chia sẻ mã cho bất kỳ ai để bảo vệ tài khoản của bạn.',
    submitButton: 'Xác nhận & Khởi tạo hồ sơ',
    inputA11yLabel: 'Mã xác thực OTP gồm 6 chữ số',
  },
  bannedScreen: {
    headerTitle: 'Tài khoản bị khoá',
    title: 'Tài khoản tạm ngưng',
    backButton: 'Quay lại màn hình đăng nhập',
  },
  trust: {
    title: 'Cam kết tôn nghiêm & Bảo mật',
    privacyTitle: 'Bảo mật danh tính:',
    privacyContent:
      'Không đăng bài lên mạng xã hội. Thông tin liên lạc chỉ mở khi đôi bên cùng chấp thuận kết nối.',
    verifiedTitle: 'Hồ sơ chuẩn mực:',
    verifiedContent:
      'Bắt buộc xác thực căn cước công dân và xác nhận tình trạng độc thân trước khi gửi lời ngỏ.',
  },
  legal: {
    prefix: 'Bằng việc tiếp tục, bạn đồng ý với ',
    terms: 'Điều khoản dịch vụ',
    and: ' và ',
    privacy: 'Chính sách quyền riêng tư',
    suffix: ' của Tâm Giao.',
  },
} as const;
