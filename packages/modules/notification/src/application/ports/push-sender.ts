/** Một push tới một thiết bị. `title`/`body` lấy từ template (không PII); `data` chỉ chứa id + loại thông báo. */
export interface PushMessage {
  readonly token: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, string>>;
}

/**
 * Kết quả gửi cho từng token (cùng thứ tự với đầu vào):
 * - `OK`: nhà cung cấp đã nhận.
 * - `INVALID_TOKEN`: token không còn hợp lệ (vd Expo `DeviceNotRegistered`) → xoá thiết bị.
 * - `ERROR`: lỗi khác; `retryable` = lỗi tạm thời (thử lại sau), ngược lại là bị từ chối vĩnh viễn.
 */
export type PushOutcome =
  | { readonly status: 'OK' }
  | { readonly status: 'INVALID_TOKEN' }
  | { readonly status: 'ERROR'; readonly retryable: boolean; readonly code: string };

/**
 * Gửi push (adapter: `ExpoPushSender`, `FakePushSender`). Lỗi cấp request (mạng, 5xx, 429) → throw (lỗi hạ tầng,
 * job thử lại); lỗi từng token → `PushOutcome`.
 */
export interface PushSender {
  send(messages: readonly PushMessage[]): Promise<readonly PushOutcome[]>;
}
