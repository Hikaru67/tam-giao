export const LOGIN_COPY = {
  headerSubtitle: 'Cổng quản trị & điều phối mai mối',
  adminBadge: 'ADMIN',
  brandEyebrow: 'Hệ thống nghiệp vụ nội bộ',
  brandName: 'Tâm Giao',
  brandTagline: 'Một người thật • Một lúc • Một cam kết',
  brandDescription:
    'Cổng điều phối nội bộ phục vụ thẩm định hồ sơ, phỏng vấn sơ bộ và kết nối mai mối nghiêm túc.',
  features: [
    { title: 'Đăng nhập 2 lớp', description: 'Mật khẩu kết hợp mã TOTP từ ứng dụng xác thực.' },
    { title: 'Phân quyền theo vai trò', description: 'Mỗi cán bộ chỉ thấy đúng các nghiệp vụ được giao.' },
    {
      title: 'Nhật ký truy cập',
      description: 'Mọi lần xem dữ liệu nhạy cảm đều được ghi lại theo Nghị định 13/2023/NĐ-CP.',
    },
  ],
  formEyebrow: 'Cổng xác thực 2 lớp (2FA)',
  title: 'Đăng nhập cán bộ quản trị',
  description: 'Vui lòng sử dụng tài khoản nghiệp vụ đã được cấp.',
  emailLabel: 'Email công vụ',
  emailPlaceholder: 'ten.canbo@tamgiao.vn',
  passwordLabel: 'Mật khẩu',
  showPassword: 'Hiện mật khẩu',
  hidePassword: 'Ẩn mật khẩu',
  totpLabel: 'Mã xác thực 2 lớp (TOTP)',
  totpHint: 'Nhập 6 chữ số từ ứng dụng xác thực (Google Authenticator, Microsoft Authenticator…).',
  rememberDevice: 'Ghi nhớ thiết bị này',
  submit: 'Đăng nhập hệ thống quản trị',
  noticeTitle: 'Giám sát truy cập',
  noticeBody:
    'Mọi thao tác xem dữ liệu nhạy cảm đều được ghi nhật ký. Không sao lưu, chụp màn hình hay chia sẻ thông tin hồ sơ người dùng.',
  footer: 'Chỉ dành cho cán bộ tư vấn và quản trị viên được cấp quyền.',
  errors: {
    emailRequired: 'Vui lòng nhập email.',
    passwordRequired: 'Vui lòng nhập mật khẩu.',
    totpInvalid: 'Mã xác thực gồm đúng 6 chữ số.',
  },
} as const;
