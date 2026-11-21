import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  WS_CLOSE_CODES,
  WS_HEARTBEAT_INTERVAL_SECONDS,
  WS_HEARTBEAT_TIMEOUT_SECONDS,
  WS_MAX_FRAME_BYTES,
  wsClientEventSchema,
  type WsClientEvent,
  type WsCloseReason,
  type WsServerEvent,
} from '@tamgiao/contracts';
import { bearerToken, type UserAuthenticator } from '@tamgiao/http';
import { newId, type DomainError } from '@tamgiao/kernel';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { JoinConversation } from '../application/conversation-access.js';
import type { MarkConversationRead } from '../application/conversation-inbox.js';
import type {
  ConversationBroadcast,
  MessageBroadcaster,
  RealtimeMessage,
} from '../application/ports/message-broadcaster.js';
import type { SendMessage } from '../application/send-message.js';
import { readBroadcast, realtimeFromSent, realtimeFromSystem, toMessageDto } from './message-dto-mapper.js';

/** Ghi log lỗi kỹ thuật của gateway (tương thích pino). Không bao giờ nhận nội dung tin / token. */
export interface ChatGatewayLogger {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** Node HTTP server (vd kết quả `serve()` của `@hono/node-server`) — gateway nghe sự kiện `upgrade`. */
export interface UpgradableServer {
  on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
  off(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
}

export interface ChatGatewayDeps {
  /** `identity.facade.authenticateUser` — cùng cách xác thực với guard `requireUser` của REST. */
  readonly authenticate: UserAuthenticator;
  readonly joinConversation: JoinConversation;
  readonly sendMessage: SendMessage;
  /** WS `message.read` → lưu con trỏ đã đọc (BE-S6-04). */
  readonly markConversationRead: MarkConversationRead;
  readonly broadcaster: MessageBroadcaster;
  readonly logger?: ChatGatewayLogger;
  /** Đường dẫn upgrade (mặc định `/ws`). */
  readonly path?: string;
  /** Mặc định `WS_HEARTBEAT_INTERVAL_SECONDS`; test đặt nhỏ. */
  readonly heartbeatIntervalMs?: number;
  /** Mặc định `WS_HEARTBEAT_TIMEOUT_SECONDS`. */
  readonly heartbeatTimeoutMs?: number;
}

interface Connection {
  readonly id: string;
  readonly socket: WebSocket;
  readonly userId: string;
  readonly token: string;
  readonly rooms: Set<string>;
  /** Có nhận frame/pong từ client kể từ nhịp heartbeat trước. */
  active: boolean;
  idleTicks: number;
  revalidating: boolean;
}

/** Lỗi `message.send` làm ngắt kết nối (AC3) — các lỗi khác chỉ trả frame `error`. */
const FATAL_SEND_ERRORS = new Set<string>(['NOT_PARTICIPANT', 'NOT_FOUND']);

function isCloseReason(code: string): code is WsCloseReason {
  return Object.hasOwn(WS_CLOSE_CODES, code);
}

/**
 * WebSocket gateway của chat (BE-S6-02) — tầng presentation: parse frame (Zod ở contracts) → gọi use case → đẩy kết quả.
 * Không chứa luật nghiệp vụ (participant, trạng thái, rate limit, idempotency nằm ở `JoinConversation`/`SendMessage`).
 *
 * - Handshake: nhận upgrade ở `path`, xác thực access token (header `Authorization` hoặc query `access_token`) qua
 *   `authenticate`; lỗi → frame `error` + đóng `4401` (lý do `UNAUTHENTICATED`/`TOKEN_EXPIRED`).
 * - Frame của một kết nối xử lý **tuần tự** (giữ thứ tự gửi tin); frame tới trước khi xác thực xong được xếp hàng.
 * - Đa instance: mọi sự kiện phòng (`message.new`, `message.read`, `typing`) đi qua `MessageBroadcaster` (Redis) — kể cả
 *   cho kết nối cùng instance — rồi mỗi instance đẩy cho kết nối cục bộ trong phòng, chọn nội dung theo người xem.
 * - Heartbeat: mỗi nhịp gửi ping frame, kiểm tra lại token (hết hạn / phiên thu hồi → `4401`), quá timeout không nhận
 *   được gì → `4408`.
 *
 * Không log nội dung tin, token hay frame thô (PII).
 */
export class ChatGateway {
  private readonly path: string;
  private readonly intervalMs: number;
  private readonly timeoutTicks: number;
  private readonly connections = new Set<Connection>();
  private readonly rooms = new Map<string, Set<Connection>>();
  private wss: WebSocketServer | null = null;
  private server: UpgradableServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private unsubscribe: (() => Promise<void>) | null = null;

  constructor(private readonly deps: ChatGatewayDeps) {
    this.path = deps.path ?? '/ws';
    this.intervalMs = deps.heartbeatIntervalMs ?? WS_HEARTBEAT_INTERVAL_SECONDS * 1_000;
    const timeoutMs = deps.heartbeatTimeoutMs ?? WS_HEARTBEAT_TIMEOUT_SECONDS * 1_000;
    this.timeoutTicks = Math.max(1, Math.ceil(timeoutMs / this.intervalMs));
  }

  /** Số kết nối đang mở trên instance này. */
  get connectionCount(): number {
    return this.connections.size;
  }

  /** Đăng ký nhận sự kiện realtime rồi gắn vào HTTP server (nghe `upgrade` ở `path`). */
  async attach(server: UpgradableServer): Promise<void> {
    if (this.wss) throw new Error('ChatGateway đã được gắn');
    this.unsubscribe = await this.deps.broadcaster.subscribe((event) => this.deliver(event));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_FRAME_BYTES });
    this.server = server;
    server.on('upgrade', this.onUpgrade);
    this.heartbeat = setInterval(() => this.tick(), this.intervalMs);
    this.heartbeat.unref();
  }

  /** Đóng mọi kết nối (`1001`), huỷ đăng ký realtime, gỡ khỏi HTTP server. */
  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.server?.off('upgrade', this.onUpgrade);
    this.server = null;
    for (const conn of this.connections) conn.socket.close(1001, 'SERVER_SHUTDOWN');
    this.connections.clear();
    this.rooms.clear();
    await this.unsubscribe?.();
    this.unsubscribe = null;
    const wss = this.wss;
    this.wss = null;
    if (wss) await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const wss = this.wss;
    if (url.pathname !== this.path || !wss) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, req, url));
  };

  private onConnection(socket: WebSocket, req: IncomingMessage, url: URL): void {
    const token = bearerToken(req.headers.authorization) ?? url.searchParams.get('access_token') ?? undefined;
    let conn: Connection | null = null;
    let queue: Promise<void> = this.authenticateConnection(socket, token).then((c) => {
      conn = c;
    });
    const enqueue = (work: (c: Connection) => Promise<void>) => {
      queue = queue
        .then(() => (conn ? work(conn) : undefined))
        .catch((error: unknown) => this.deps.logger?.error({ err: error }, 'ws frame handling failed'));
    };
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (conn) conn.active = true;
      enqueue((c) => this.handleFrame(c, data, isBinary));
    });
    socket.on('pong', () => {
      if (conn) conn.active = true;
    });
    socket.on('close', () => {
      if (conn) this.removeConnection(conn);
    });
    socket.on('error', (error: Error) => this.deps.logger?.warn({ err: error }, 'ws socket error'));
  }

  private async authenticateConnection(
    socket: WebSocket,
    token: string | undefined,
  ): Promise<Connection | null> {
    if (token === undefined || token.length === 0) {
      this.closeSocket(socket, 'UNAUTHENTICATED');
      return null;
    }
    const auth = await this.deps.authenticate(token);
    if (auth.isErr()) {
      this.closeSocket(socket, auth.error.code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED');
      return null;
    }
    if (socket.readyState !== WebSocket.OPEN) return null;
    const conn: Connection = {
      id: newId<'WsConnection'>(),
      socket,
      userId: auth.value.userId.toLowerCase(),
      token,
      rooms: new Set(),
      active: true,
      idleTicks: 0,
      revalidating: false,
    };
    this.connections.add(conn);
    this.send(conn, { type: 'ready', userId: conn.userId });
    return conn;
  }

  private async handleFrame(conn: Connection, data: RawData, isBinary: boolean): Promise<void> {
    if (isBinary) {
      this.send(conn, { type: 'error', code: 'VALIDATION_FAILED' });
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(rawToString(data));
    } catch {
      this.send(conn, { type: 'error', code: 'VALIDATION_FAILED' });
      return;
    }
    const parsed = wsClientEventSchema.safeParse(raw);
    if (!parsed.success) {
      // Chỉ trả đường dẫn trường lỗi, không trả lại giá trị client gửi (có thể là PII).
      const fields = parsed.error.issues.map((i) => i.path.map(String).join('.'));
      this.send(conn, { type: 'error', code: 'VALIDATION_FAILED', meta: { fields } });
      return;
    }
    await this.handleEvent(conn, parsed.data);
  }

  private async handleEvent(conn: Connection, event: WsClientEvent): Promise<void> {
    switch (event.type) {
      case 'ping':
        this.send(conn, { type: 'pong' });
        return;
      case 'conversation.join':
        return this.join(conn, event.conversationId);
      case 'conversation.leave':
        this.leave(conn, event.conversationId.toLowerCase());
        return;
      case 'message.send':
        return this.sendMessage(conn, event);
      case 'message.read':
        return this.markRead(conn, event);
      case 'typing':
        return this.publishRoomEvent(conn, event.conversationId, (conversationId) => ({
          type: 'typing',
          conversationId,
          originConnectionId: conn.id,
          userId: conn.userId,
          isTyping: event.isTyping,
        }));
    }
  }

  private async join(conn: Connection, rawConversationId: string): Promise<void> {
    const joined = await this.deps.joinConversation.execute({
      conversationId: rawConversationId,
      userId: conn.userId,
    });
    if (joined.isErr()) {
      this.closeConnection(conn, joined.error, { conversationId: rawConversationId.toLowerCase() });
      return;
    }
    const { conversationId, status } = joined.value;
    if (conn.socket.readyState !== WebSocket.OPEN) return;
    conn.rooms.add(conversationId);
    let room = this.rooms.get(conversationId);
    if (!room) {
      room = new Set();
      this.rooms.set(conversationId, room);
    }
    room.add(conn);
    this.send(conn, { type: 'conversation.joined', conversationId, status });
  }

  private leave(conn: Connection, conversationId: string): void {
    conn.rooms.delete(conversationId);
    const room = this.rooms.get(conversationId);
    room?.delete(conn);
    if (room?.size === 0) this.rooms.delete(conversationId);
  }

  private async sendMessage(
    conn: Connection,
    event: Extract<WsClientEvent, { type: 'message.send' }>,
  ): Promise<void> {
    const clientMessageId = event.clientMessageId.toLowerCase();
    const result = await this.deps.sendMessage.execute({
      conversationId: event.conversationId,
      senderId: conn.userId,
      body: event.body,
      clientMessageId,
    });
    if (result.isErr()) {
      const extra = { clientMessageId, conversationId: event.conversationId.toLowerCase() };
      if (FATAL_SEND_ERRORS.has(result.error.code)) {
        this.closeConnection(conn, result.error, extra);
      } else {
        this.sendError(conn, result.error, extra);
      }
      return;
    }
    const message = realtimeFromSent(result.value);
    this.send(conn, {
      type: 'message.ack',
      clientMessageId,
      duplicate: result.value.replayed,
      message: toMessageDto(message, conn.userId),
    });
    // Gửi lại (replayed) vẫn phát lại: lần trước có thể đã lưu nhưng chưa kịp phát; client khử trùng theo messageId.
    await this.publish({
      type: 'message.new',
      conversationId: message.conversationId,
      originConnectionId: conn.id,
      message,
    });
    // Tin hệ thống tạo kèm (cảnh báo lừa đảo cho người nhận) — đẩy cho mọi kết nối, lọc theo `visibleTo` khi giao.
    for (const system of result.value.systemMessages) {
      await this.publish({
        type: 'message.new',
        conversationId: system.conversationId,
        originConnectionId: null,
        message: realtimeFromSystem(system),
      });
    }
  }

  /**
   * `message.read` (BE-S6-04): chỉ phòng đã join; lưu con trỏ qua `MarkConversationRead` (cùng use case với REST
   * `POST /me/conversations/:id/read`). Lỗi (vd tin không thuộc hội thoại → `NOT_FOUND`) → frame `error`, giữ kết nối.
   * Chỉ phát cho phòng khi con trỏ thật sự tiến.
   */
  private async markRead(
    conn: Connection,
    event: Extract<WsClientEvent, { type: 'message.read' }>,
  ): Promise<void> {
    const conversationId = event.conversationId.toLowerCase();
    if (!conn.rooms.has(conversationId)) {
      this.send(conn, { type: 'error', code: 'CONVERSATION_NOT_JOINED', conversationId });
      return;
    }
    const result = await this.deps.markConversationRead.execute({
      conversationId,
      userId: conn.userId,
      messageId: event.messageId,
    });
    if (result.isErr()) {
      this.sendError(conn, result.error, { conversationId });
      return;
    }
    if (result.value.advanced) await this.publish(readBroadcast(result.value, conn.id));
  }

  /** `typing`: chỉ cho phòng đã join trên kết nối này (đã kiểm tra participant lúc join). */
  private async publishRoomEvent(
    conn: Connection,
    rawConversationId: string,
    build: (conversationId: string) => ConversationBroadcast,
  ): Promise<void> {
    const conversationId = rawConversationId.toLowerCase();
    if (!conn.rooms.has(conversationId)) {
      this.send(conn, { type: 'error', code: 'CONVERSATION_NOT_JOINED', conversationId });
      return;
    }
    await this.publish(build(conversationId));
  }

  private async publish(event: ConversationBroadcast): Promise<void> {
    try {
      await this.deps.broadcaster.publish(event);
    } catch (error) {
      // Tin đã lưu; người nhận lấy bù qua REST khi nối lại. Không log payload (PII).
      this.deps.logger?.warn({ err: error, eventType: event.type }, 'realtime publish failed');
    }
  }

  /** Sự kiện từ broadcaster (mọi instance) → kết nối cục bộ trong phòng, trừ kết nối phát ra. */
  private deliver(event: ConversationBroadcast): void {
    const room = this.rooms.get(event.conversationId);
    if (!room) return;
    for (const conn of room) {
      if (conn.id === event.originConnectionId) continue;
      if (event.type === 'message.new' && !isVisible(event.message, conn.userId)) continue;
      this.send(conn, toServerEvent(event, conn.userId));
    }
  }

  private tick(): void {
    for (const conn of this.connections) {
      conn.idleTicks = conn.active ? 0 : conn.idleTicks + 1;
      conn.active = false;
      if (conn.idleTicks >= this.timeoutTicks) {
        // Client không còn phản hồi → đóng, không gửi frame `error` (mã đóng là đủ).
        this.removeConnection(conn);
        conn.socket.close(WS_CLOSE_CODES.HEARTBEAT_TIMEOUT, 'HEARTBEAT_TIMEOUT');
        continue;
      }
      if (conn.socket.readyState === WebSocket.OPEN) conn.socket.ping();
      void this.revalidate(conn);
    }
  }

  /** Token hết hạn / phiên bị thu hồi giữa chừng → ngắt `4401`. */
  private async revalidate(conn: Connection): Promise<void> {
    if (conn.revalidating) return;
    conn.revalidating = true;
    try {
      const auth = await this.deps.authenticate(conn.token);
      if (auth.isErr()) {
        this.closeConnection(conn, {
          code: auth.error.code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED',
        });
      }
    } catch (error) {
      // Hạ tầng lỗi tạm thời (DB) → giữ kết nối, thử lại nhịp sau.
      this.deps.logger?.warn({ err: error }, 'ws token revalidation failed');
    } finally {
      conn.revalidating = false;
    }
  }

  private send(conn: Connection, event: WsServerEvent): void {
    if (conn.socket.readyState === WebSocket.OPEN) conn.socket.send(JSON.stringify(event));
  }

  private sendError(
    conn: Connection,
    error: DomainError,
    extra: { readonly clientMessageId?: string; readonly conversationId?: string } = {},
  ): void {
    this.send(conn, {
      type: 'error',
      code: error.code,
      ...extra,
      ...(error.details === undefined ? {} : { meta: { ...error.details } }),
    });
  }

  /** Frame `error` rồi đóng với mã theo `WS_CLOSE_CODES` (lý do = mã lỗi). */
  private closeConnection(
    conn: Connection,
    error: DomainError,
    extra: { readonly clientMessageId?: string; readonly conversationId?: string } = {},
  ): void {
    this.sendError(conn, error, extra);
    this.removeConnection(conn);
    const reason = isCloseReason(error.code) ? error.code : 'NOT_PARTICIPANT';
    conn.socket.close(WS_CLOSE_CODES[reason], reason);
  }

  /** Đóng socket chưa xác thực (chưa có `Connection`). */
  private closeSocket(socket: WebSocket, reason: WsCloseReason): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    const frame: WsServerEvent = { type: 'error', code: reason };
    socket.send(JSON.stringify(frame));
    socket.close(WS_CLOSE_CODES[reason], reason);
  }

  private removeConnection(conn: Connection): void {
    if (!this.connections.delete(conn)) return;
    for (const conversationId of [...conn.rooms]) this.leave(conn, conversationId);
  }
}

/** Tin chỉ dành cho một người (`visibleTo`) không giao cho người khác — cùng luật `Message.isVisibleTo`. */
function isVisible(message: RealtimeMessage, viewerId: string): boolean {
  return message.visibleTo === null || message.visibleTo === viewerId;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/** Sự kiện phòng → frame cho một người xem cụ thể. */
function toServerEvent(event: ConversationBroadcast, viewerId: string): WsServerEvent {
  switch (event.type) {
    case 'message.new':
      return { type: 'message.new', message: toMessageDto(event.message, viewerId) };
    case 'message.read':
      return {
        type: 'message.read',
        conversationId: event.conversationId,
        readerId: event.readerId,
        messageId: event.messageId,
        readAt: event.readAt,
      };
    case 'typing':
      return {
        type: 'typing',
        conversationId: event.conversationId,
        userId: event.userId,
        isTyping: event.isTyping,
      };
  }
}
