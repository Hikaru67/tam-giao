import { randomUUID } from 'node:crypto';

/**
 * Client WebSocket chat tối thiểu (`/ws`, BE-S6-02) dùng `WebSocket` có sẵn của Node 22. Token gửi qua query
 * `access_token` (gateway chấp nhận cả header lẫn query). Không log nội dung tin (PII).
 */
export interface ChatEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export class ChatClient {
  private readonly events: ChatEvent[] = [];
  private readonly waiters: { match: (e: ChatEvent) => boolean; resolve: (e: ChatEvent) => void }[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (msg) => {
      const event = JSON.parse(String(msg.data)) as ChatEvent;
      const waiter = this.waiters.findIndex((w) => w.match(event));
      if (waiter >= 0) this.waiters.splice(waiter, 1)[0]?.resolve(event);
      else this.events.push(event);
    });
  }

  static async connect(baseUrl: string, accessToken: string, timeoutMs = 10_000): Promise<ChatClient> {
    const url = new URL('/ws', baseUrl.replace(/^http/, 'ws'));
    url.searchParams.set('access_token', accessToken);
    const socket = new WebSocket(url);
    const client = new ChatClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('không mở được WebSocket /ws')), {
        once: true,
      });
    });
    await client.next((e) => e.type === 'ready', timeoutMs);
    return client;
  }

  send(event: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(event));
  }

  /** Sự kiện đầu tiên thoả `match` (kể cả đã nhận trước đó); hết hạn → throw. */
  next(match: (e: ChatEvent) => boolean, timeoutMs = 10_000): Promise<ChatEvent> {
    const buffered = this.events.findIndex(match);
    if (buffered >= 0) return Promise.resolve(this.events.splice(buffered, 1)[0] as ChatEvent);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('hết thời gian chờ sự kiện WebSocket'));
      }, timeoutMs);
      const waiter = {
        match,
        resolve: (e: ChatEvent) => {
          clearTimeout(timer);
          resolve(e);
        },
      };
      this.waiters.push(waiter);
    });
  }

  async join(conversationId: string): Promise<ChatEvent> {
    this.send({ type: 'conversation.join', conversationId });
    const event = await this.next(
      (e) => (e.type === 'conversation.joined' || e.type === 'error') && e.conversationId === conversationId,
    );
    if (event.type === 'error') throw new Error(`conversation.join lỗi ${String(event.code)}`);
    return event;
  }

  /** Gửi tin, chờ `message.ack`; trả về ack. */
  async sendMessage(conversationId: string, body: string): Promise<ChatEvent> {
    const clientMessageId = randomUUID();
    this.send({ type: 'message.send', conversationId, clientMessageId, body });
    const event = await this.next(
      (e) => (e.type === 'message.ack' || e.type === 'error') && e.clientMessageId === clientMessageId,
    );
    if (event.type === 'error') throw new Error(`message.send lỗi ${String(event.code)}`);
    return event;
  }

  close(): void {
    this.socket.close(1000);
  }
}
