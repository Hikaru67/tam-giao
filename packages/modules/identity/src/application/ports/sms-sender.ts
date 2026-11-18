export interface SmsMessage {
  /** Số nhận, dạng E.164. */
  readonly to: string;
  readonly text: string;
}

/** Gửi SMS (nhà cung cấp brandname chờ quyết định D4). Lỗi gửi → throw (lỗi hạ tầng). */
export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}
