import type { PushMessage, PushOutcome, PushSender } from '../application/ports/push-sender.js';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo nhận tối đa 100 thông báo / request. */
const EXPO_BATCH_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Lỗi cấp request khi gọi Expo (mạng, timeout, HTTP lỗi, body lạ) — lỗi hạ tầng, job thử lại. */
export class ExpoPushError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message);
    this.name = 'ExpoPushError';
  }
}

export interface ExpoPushSenderOptions {
  /** Access token "Enhanced push security" của Expo (tuỳ chọn). */
  readonly accessToken?: string;
  readonly url?: string;
  readonly timeoutMs?: number;
  /** Tiêm `fetch` (test). */
  readonly fetch?: typeof fetch;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Ticket Expo → kết quả: `DeviceNotRegistered` = token hỏng (xoá); `MessageRateExceeded` = tạm thời; còn lại vĩnh viễn. */
function toOutcome(ticket: unknown): PushOutcome {
  if (!isRecord(ticket)) return { status: 'ERROR', retryable: true, code: 'MALFORMED_TICKET' };
  if (ticket.status === 'ok') return { status: 'OK' };
  const details = isRecord(ticket.details) ? ticket.details : {};
  const code = typeof details.error === 'string' ? details.error : 'UNKNOWN';
  if (code === 'DeviceNotRegistered') return { status: 'INVALID_TOKEN' };
  return { status: 'ERROR', retryable: code === 'MessageRateExceeded', code };
}

/**
 * `PushSender` qua Expo Push API (D4 / mobile Expo). Gửi theo lô 100; chỉ dùng ticket trả về ngay (bước đọc receipt
 * để phát hiện token hỏng muộn chưa làm). Không log nội dung push.
 */
export class ExpoPushSender implements PushSender {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: ExpoPushSenderOptions = {}) {
    this.url = options.url ?? EXPO_PUSH_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetch ?? fetch;
  }

  async send(messages: readonly PushMessage[]): Promise<readonly PushOutcome[]> {
    const outcomes: PushOutcome[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      outcomes.push(...(await this.sendBatch(messages.slice(i, i + EXPO_BATCH_SIZE))));
    }
    return outcomes;
  }

  private async sendBatch(batch: readonly PushMessage[]): Promise<PushOutcome[]> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (this.options.accessToken !== undefined) headers.authorization = `Bearer ${this.options.accessToken}`;
    let response: Response;
    try {
      response = await this.fetchFn(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          batch.map((m) => ({
            to: m.token,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
            priority: 'high',
          })),
        ),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ExpoPushError(`expo push request failed: ${(error as Error).name}`, null);
    }
    if (!response.ok) throw new ExpoPushError(`expo push HTTP ${response.status}`, response.status);
    const body: unknown = await response.json().catch(() => null);
    const tickets = isRecord(body) && Array.isArray(body.data) ? body.data : null;
    if (tickets === null || tickets.length !== batch.length) {
      throw new ExpoPushError('expo push: response không có đủ ticket', response.status);
    }
    return tickets.map(toOutcome);
  }
}
