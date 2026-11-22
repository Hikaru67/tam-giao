/**
 * Quản lý deviceId của thiết bị đã đăng ký push notification trong bộ nhớ (F4: không lưu PII/thiết bị vào storage).
 * State này chỉ tồn tại trong phiên làm việc hiện tại và được xoá khi đăng xuất.
 */
let currentDeviceId: string | null = null;

export function getRegisteredDeviceId(): string | null {
  return currentDeviceId;
}

export function setRegisteredDeviceId(deviceId: string | null): void {
  currentDeviceId = deviceId;
}
