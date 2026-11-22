import { registerErrors } from '../errors.js';

/** Mã lỗi quyền dữ liệu cá nhân (BE-S7-06): xuất dữ liệu + xoá tài khoản. */
export const DATA_RIGHTS_ERROR_CODES = registerErrors('identity', {
  /** File xuất dữ liệu đang được dựng (`PENDING`). */
  DATA_EXPORT_NOT_READY: { status: 409, title: 'File dữ liệu chưa sẵn sàng' },
  /** Quá thời hạn tải file xuất dữ liệu (24 giờ kể từ khi sẵn sàng) — cần yêu cầu xuất lại. */
  DATA_EXPORT_EXPIRED: { status: 410, title: 'Liên kết tải dữ liệu đã hết hạn' },
  /** Liên kết tải sai chữ ký / bị sửa. */
  DATA_EXPORT_LINK_INVALID: { status: 403, title: 'Liên kết tải dữ liệu không hợp lệ' },
});
