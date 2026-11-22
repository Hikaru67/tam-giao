/** Payload event module identity phát ra ngoài (qua outbox). Không chứa PII — consumer tự tra theo id. */
export const USER_REGISTERED = 'UserRegistered';
export interface UserRegisteredPayload {
  readonly userId: string;
}

/**
 * Người dùng yêu cầu xoá tài khoản (BE-S7-06, quyền của chủ thể dữ liệu — NĐ 13/2023), đã xác nhận OTP. Phát cùng
 * transaction với việc ẩn danh tài khoản identity (SĐT) + thu hồi mọi phiên. Mỗi module tiêu thụ bằng consumer riêng để
 * tự ẩn danh/xoá dữ liệu của mình (idempotent): profile, verification, billing (giữ ledger), matching (đóng match đang
 * mở), messaging, safety (giữ báo cáo dạng ẩn danh), uploads. `requestId` = id yêu cầu, tra trạng thái ở
 * `GET /account-deletions/:requestId`. `requestedAt` ISO 8601 UTC.
 */
export const ACCOUNT_DELETION_REQUESTED = 'AccountDeletionRequested';
export interface AccountDeletionRequestedPayload {
  readonly requestId: string;
  readonly userId: string;
  readonly requestedAt: string;
}

/** Người dùng yêu cầu xuất dữ liệu cá nhân (BE-S7-06). Chỉ identity tiêu thụ (worker dựng file JSON từ các module). */
export const DATA_EXPORT_REQUESTED = 'DataExportRequested';
export interface DataExportRequestedPayload {
  readonly exportId: string;
  readonly userId: string;
}
