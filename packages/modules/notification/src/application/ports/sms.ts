/**
 * Kênh SMS dùng lại adapter của identity (`ConsoleSmsSender`, nhà cung cấp brandname chờ D4): kiểu khai báo lại ở đây
 * (cùng hình dạng với `SmsSender` của identity) để không import sâu vào module khác (A3) — composition root truyền chính
 * instance của identity vào.
 */
export interface SmsMessage {
  /** Số nhận, dạng E.164. */
  readonly to: string;
  readonly text: string;
}

export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}

/**
 * Tra SĐT (E.164) của người dùng để gửi SMS thay thế. SĐT là PII, do identity giữ (mã hoá) — composition root nối tới
 * facade identity. Không có số → `null`.
 */
export interface PhoneDirectory {
  findPhoneNumber(userId: string): Promise<string | null>;
}
