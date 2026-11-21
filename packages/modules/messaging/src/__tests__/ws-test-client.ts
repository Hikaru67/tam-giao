import { wsServerEventSchema, type WsClientEvent, type WsServerEvent } from '@tamgiao/contracts';
import { WebSocket } from 'ws';

const WAIT_MS = 5_000;

/** Client WS cho test: gom frame server gửi (kiểm tra schema), chờ frame theo điều kiện, chờ đóng kết nối. */
export class WsTestClient {
  readonly frames: WsServerEvent[] = [];
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
  private readonly waiters: { match: (f: WsServerEvent) => boolean; resolve: (f: WsServerEvent) => void }[] =
    [];

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      // Mọi frame server gửi phải khớp schema hợp đồng (`packages/contracts/src/messaging/ws.ts`).
      const frame = wsServerEventSchema.parse(JSON.parse(String(data)));
      this.frames.push(frame);
      for (const w of [...this.waiters]) {
        if (w.match(frame)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(frame);
        }
      }
    });
    this.closed = new Promise((resolve) => {
      socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
  }

  /** Mở kết nối (chưa chờ `ready`). `token` gửi qua header `Authorization`, hoặc query khi `via = 'query'`. */
  static async connect(
    baseUrl: string,
    token?: string,
    via: 'header' | 'query' = 'header',
  ): Promise<WsTestClient> {
    const url = new URL('/ws', baseUrl.replace(/^http/, 'ws'));
    if (token !== undefined && via === 'query') url.searchParams.set('access_token', token);
    const socket = new WebSocket(url, {
      headers: token !== undefined && via === 'header' ? { authorization: `Bearer ${token}` } : {},
    });
    const client = new WsTestClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return client;
  }

  /** Kết nối + chờ frame `ready`. */
  static async ready(baseUrl: string, token: string): Promise<WsTestClient> {
    const client = await WsTestClient.connect(baseUrl, token);
    await client.next((f) => f.type === 'ready');
    return client;
  }

  send(event: WsClientEvent | Record<string, unknown>): void {
    this.socket.send(JSON.stringify(event));
  }

  /** Frame đầu tiên (đã nhận hoặc sắp nhận) thoả `match`. */
  next<T extends WsServerEvent['type']>(
    match: (f: WsServerEvent) => boolean,
    timeoutMs = WAIT_MS,
  ): Promise<Extract<WsServerEvent, { type: T }>> {
    const seen = this.frames.find(match);
    if (seen) return Promise.resolve(seen as Extract<WsServerEvent, { type: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout chờ frame WS')), timeoutMs);
      this.waiters.push({
        match,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f as Extract<WsServerEvent, { type: T }>);
        },
      });
    });
  }

  async join(conversationId: string): Promise<void> {
    this.send({ type: 'conversation.join', conversationId });
    await this.next((f) => f.type === 'conversation.joined' && f.conversationId === conversationId);
  }

  ofType<T extends WsServerEvent['type']>(type: T): Extract<WsServerEvent, { type: T }>[] {
    return this.frames.filter((f): f is Extract<WsServerEvent, { type: T }> => f.type === type);
  }

  close(): void {
    this.socket.close();
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
