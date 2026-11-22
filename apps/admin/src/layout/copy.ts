import type { AdminRoleName } from '@tamgiao/contracts/identity';

/**
 * Văn bản khung điều hướng admin (luật F6). FE-D6: không có thống kê header, "Mã ca trực", trạng thái máy chủ.
 * FE-D5: không có "VNeID", "Bộ Công An", "Bộ Ngoại Giao", "ký quỹ".
 */
export const NAV_COPY = {
  overview: 'Tổng quan',
  kyc: 'Thẩm định eKYC',
  interviews: 'Lịch phỏng vấn',
  audit: 'Nhật ký truy cập',
} as const;

export const ROLE_LABELS = {
  REVIEWER: 'Chuyên viên thẩm định',
  MATCHMAKER: 'Chuyên viên mai mối',
  SUPERVISOR: 'Giám sát vận hành',
  ADMIN: 'Quản trị hệ thống',
} as const satisfies Record<AdminRoleName, string>;

export const SHELL_COPY = {
  brand: 'Tâm Giao',
  portalName: 'Cổng quản trị',
  navLabel: 'Điều hướng chính',
  logout: 'Đăng xuất',
  roleLabel: 'Vai trò',
} as const;

export const FORBIDDEN_COPY = {
  title: 'Bạn không đủ quyền truy cập mục này',
  description:
    'Vai trò hiện tại chưa được cấp quyền cho nghiệp vụ này. Liên hệ quản trị hệ thống nếu bạn cần truy cập.',
  backHome: 'Về trang tổng quan',
} as const;

export const COMING_SOON_COPY = {
  title: 'Màn hình đang được hoàn thiện',
  description: 'Nghiệp vụ này sẽ sớm có trên cổng quản trị.',
} as const;

export const NOT_FOUND_COPY = {
  title: 'Không tìm thấy trang',
  backHome: 'Về trang tổng quan',
} as const;

export const OVERVIEW_COPY = {
  title: 'Xin chào',
  rolePrefix: 'Bạn đang đăng nhập với vai trò',
  sectionsTitle: 'Nghiệp vụ của bạn',
  noSections: 'Tài khoản chưa được cấp nghiệp vụ nào. Liên hệ quản trị hệ thống.',
} as const;
