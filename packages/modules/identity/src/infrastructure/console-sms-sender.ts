import type { SmsMessage, SmsSender } from '../application/ports/sms-sender.js';

/**
 * "Nhà mạng" của máy dev (D4 chưa chốt): in SMS ra stdout để lập trình viên đọc OTP.
 * Cố ý KHÔNG đi qua logger (log không được chứa OTP/SĐT — AGENTS.md mục 5) và bị cấm ở production
 * bởi `apps/api/src/config.ts`.
 */
export class ConsoleSmsSender implements SmsSender {
  constructor(private readonly write: (line: string) => void = (line) => void process.stdout.write(line)) {}

  async send(message: SmsMessage): Promise<void> {
    this.write(`[sms:dev] to=${message.to} text=${message.text}\n`);
  }
}
