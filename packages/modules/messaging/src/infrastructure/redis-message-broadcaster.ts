import { Redis } from 'ioredis';
import type {
  ConversationBroadcast,
  ConversationBroadcastListener,
  MessageBroadcaster,
} from '../application/ports/message-broadcaster.js';

export const DEFAULT_MESSAGING_REDIS_CHANNEL = 'tamgiao:messaging:conversation-events';

const BROADCAST_TYPES = new Set<string>(['message.new', 'message.read', 'typing']);

export interface RedisMessageBroadcasterOptions {
  /** `redis://…` */
  readonly url: string;
  /** Kênh pub/sub (mặc định `DEFAULT_MESSAGING_REDIS_CHANNEL`; test dùng kênh riêng). */
  readonly channel?: string;
  /** Lỗi kết nối / sự kiện hỏng. Không bao giờ nhận nội dung tin (chỉ đối tượng lỗi). */
  readonly onError?: (error: unknown) => void;
}

/** Sự kiện đọc từ Redis: kiểm tra hình dạng tối thiểu (kênh nội bộ, do chính API ghi). */
function parseBroadcast(raw: string): ConversationBroadcast | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { type?: unknown; conversationId?: unknown };
  if (typeof candidate.type !== 'string' || !BROADCAST_TYPES.has(candidate.type)) return null;
  if (typeof candidate.conversationId !== 'string') return null;
  return value as ConversationBroadcast;
}

/**
 * `MessageBroadcaster` trên Redis pub/sub (BE-S6-02): một kênh chung cho mọi hội thoại, mỗi instance API nhận hết và tự
 * lọc theo phòng có kết nối cục bộ (đủ cho quy mô MVP; tách kênh theo hội thoại khi cần). Hai kết nối: một để
 * `PUBLISH`, một ở chế độ subscriber (Redis bắt buộc tách). Payload JSON chứa nội dung tin (PII) — không log payload.
 */
export class RedisMessageBroadcaster implements MessageBroadcaster {
  private readonly channel: string;
  private readonly publisher: Redis;
  private readonly listeners = new Set<ConversationBroadcastListener>();
  private subscriber: Promise<Redis> | null = null;

  constructor(private readonly options: RedisMessageBroadcasterOptions) {
    this.channel = options.channel ?? DEFAULT_MESSAGING_REDIS_CHANNEL;
    this.publisher = new Redis(options.url, { maxRetriesPerRequest: 3 });
    this.publisher.on('error', (error: unknown) => this.reportError(error));
  }

  async publish(event: ConversationBroadcast): Promise<void> {
    await this.publisher.publish(this.channel, JSON.stringify(event));
  }

  async subscribe(listener: ConversationBroadcastListener): Promise<() => Promise<void>> {
    this.listeners.add(listener);
    this.subscriber ??= this.startSubscriber();
    await this.subscriber;
    return async () => {
      this.listeners.delete(listener);
    };
  }

  /** Đóng cả hai kết nối Redis (khi tắt API). */
  async close(): Promise<void> {
    this.listeners.clear();
    const subscriber = this.subscriber ? await this.subscriber.catch(() => null) : null;
    await Promise.all([this.publisher.quit(), subscriber?.quit()]);
  }

  private async startSubscriber(): Promise<Redis> {
    const subscriber = this.publisher.duplicate();
    subscriber.on('error', (error: unknown) => this.reportError(error));
    subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== this.channel) return;
      const event = parseBroadcast(raw);
      if (!event) {
        this.reportError(new Error('messaging: sự kiện realtime sai định dạng'));
        return;
      }
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (error) {
          this.reportError(error);
        }
      }
    });
    await subscriber.subscribe(this.channel);
    return subscriber;
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error);
  }
}
