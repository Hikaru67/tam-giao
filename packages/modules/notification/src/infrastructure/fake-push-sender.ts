import type { PushMessage, PushOutcome, PushSender } from '../application/ports/push-sender.js';

/**
 * `PushSender` giả cho dev/test: ghi lại mọi push đã gửi. Token trong `invalidTokens` → `INVALID_TOKEN` (giống Expo
 * `DeviceNotRegistered`); `failWith` → mọi token trả `ERROR` với cờ `retryable` cho trước.
 */
export class FakePushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  readonly invalidTokens = new Set<string>();
  failWith: { readonly retryable: boolean; readonly code: string } | null = null;

  async send(messages: readonly PushMessage[]): Promise<readonly PushOutcome[]> {
    return messages.map((m): PushOutcome => {
      if (this.invalidTokens.has(m.token)) return { status: 'INVALID_TOKEN' };
      if (this.failWith !== null) return { status: 'ERROR', ...this.failWith };
      this.sent.push(m);
      return { status: 'OK' };
    });
  }
}
