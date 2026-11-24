import {
  WS_CLOSE_CODES,
  WS_HEARTBEAT_INTERVAL_SECONDS,
  WS_HEARTBEAT_TIMEOUT_SECONDS,
  wsServerEventSchema,
  type ConversationMessageDto,
  type WsClientEvent,
} from '@tamgiao/contracts/messaging';
import { createUuidV4 } from './uuid.js';

export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export interface ChatClientOptions {
  url: string;
  getAccessToken(): Promise<string | null>;
  /** Làm mới phiên (vd gọi một API REST cần đăng nhập để api-client tự refresh). Ném lỗi có status 401 → phiên đã hết. */
  refreshSession(): Promise<void>;
  createWebSocket(url: string, headers: Readonly<Record<string, string>>): WebSocketLike;
  createId?: (() => string) | undefined;
  random?: (() => number) | undefined;
  now?: (() => number) | undefined;
  timers?:
    | {
        setTimeout(fn: () => void, ms: number): unknown;
        clearTimeout(handle: unknown): void;
      }
    | undefined;
}

export type ChatConnectionState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'signed_out';

export interface PendingMessage {
  readonly clientMessageId: string;
  readonly conversationId: string;
  readonly body: string;
  readonly createdAt: number;
  readonly status: 'sending' | 'failed';
  readonly error?:
    | {
        readonly code: string;
        readonly meta?: Readonly<Record<string, unknown>> | undefined;
      }
    | undefined;
}

export type ChatClientEvent =
  | { type: 'state'; state: ChatConnectionState }
  | { type: 'joined'; conversationId: string; status: 'OPEN' | 'CLOSED' }
  | { type: 'message'; message: ConversationMessageDto }
  | { type: 'read'; conversationId: string; readerId: string; messageId: string; readAt: string }
  | { type: 'pending'; conversationId: string }
  | { type: 'conversation-error'; conversationId: string; code: string };

export interface ChatClient {
  connect(): void;
  disconnect(): void;
  reconnectNow(): void;
  join(id: string): void;
  leave(id: string): void;
  send(conversationId: string, body: string): string;
  retry(clientMessageId: string): void;
  discard(clientMessageId: string): void;
  confirm(messages: readonly ConversationMessageDto[]): void;
  getState(): ChatConnectionState;
  getPending(conversationId: string): readonly PendingMessage[];
  subscribe(listener: (e: ChatClientEvent) => void): () => void;
}

/** Tin đã gửi mà chưa có ack sau khoảng này → coi như kết nối hỏng, nối lại và gửi lại. */
export const ACK_TIMEOUT_MS = 15_000;
/** Mở socket mà chưa nhận `ready` sau khoảng này → nối lại (mạng treo không phát `close`). */
export const CONNECT_TIMEOUT_MS = 15_000;
const CLOSE_CODE_CLIENT_TIMEOUT = 4000;
const EMPTY_PENDING: readonly PendingMessage[] = Object.freeze([]);

export function createChatClient(options: ChatClientOptions): ChatClient {
  const createId = options.createId ?? (() => createUuidV4(options.random));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const timers = options.timers ?? globalThis;

  let state: ChatConnectionState = 'idle';
  let currentGeneration = 0;
  let socket: WebSocketLike | null = null;
  let reconnectAttempt = 0;
  let hasRefreshedSinceLastReady = false;

  let reconnectTimerHandle: unknown = null;
  let connectTimerHandle: unknown = null;
  let pingTimerHandle: unknown = null;
  let heartbeatTimeoutHandle: unknown = null;

  const ackTimers = new Map<string, unknown>();
  const listeners = new Set<(e: ChatClientEvent) => void>();
  const joinedRooms = new Set<string>();
  const confirmedRooms = new Set<string>();
  const pendingMap = new Map<string, readonly PendingMessage[]>();

  function emit(event: ChatClientEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Bỏ qua lỗi phát sinh từ listener phía người gọi để không ảnh hưởng đến các listener khác
      }
    }
  }

  function setState(newState: ChatConnectionState): void {
    if (state !== newState) {
      state = newState;
      emit({ type: 'state', state: newState });
    }
  }

  function clearReconnectTimer(): void {
    if (reconnectTimerHandle !== null) {
      timers.clearTimeout(reconnectTimerHandle);
      reconnectTimerHandle = null;
    }
  }

  function clearConnectTimer(): void {
    if (connectTimerHandle !== null) {
      timers.clearTimeout(connectTimerHandle);
      connectTimerHandle = null;
    }
  }

  function safeSend(ws: WebSocketLike, frame: WsClientEvent): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // Socket vừa đóng: pending vẫn 'sending', sẽ gửi lại sau khi nối lại.
    }
  }

  function detach(ws: WebSocketLike): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }

  /**
   * Bỏ socket hiện tại ngay, không chờ sự kiện `close`: khi mạng treo, `close` có thể tới rất muộn hoặc không tới.
   */
  function dropSocket(code: number, reason: string): void {
    const ws = socket;
    if (ws === null) return;
    detach(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Socket đã hỏng: vẫn nối lại bên dưới.
    }
    handleClose(code, currentGeneration);
  }

  function clearHeartbeatTimers(): void {
    if (pingTimerHandle !== null) {
      timers.clearTimeout(pingTimerHandle);
      pingTimerHandle = null;
    }
    if (heartbeatTimeoutHandle !== null) {
      timers.clearTimeout(heartbeatTimeoutHandle);
      heartbeatTimeoutHandle = null;
    }
  }

  function clearAckTimer(clientMessageId: string): void {
    const handle = ackTimers.get(clientMessageId);
    if (handle !== undefined) {
      timers.clearTimeout(handle);
      ackTimers.delete(clientMessageId);
    }
  }

  function clearAllAckTimers(): void {
    for (const handle of ackTimers.values()) {
      timers.clearTimeout(handle);
    }
    ackTimers.clear();
  }

  function setPendingForConversation(conversationId: string, messages: readonly PendingMessage[]): void {
    if (messages.length === 0) {
      pendingMap.delete(conversationId);
    } else {
      pendingMap.set(conversationId, Object.freeze([...messages]));
    }
  }

  function addPendingMessage(pending: PendingMessage): void {
    const current = pendingMap.get(pending.conversationId) ?? [];
    setPendingForConversation(pending.conversationId, [...current, pending]);
    emit({ type: 'pending', conversationId: pending.conversationId });
  }

  function removePendingMessage(clientMessageId: string): PendingMessage | null {
    for (const [convId, list] of pendingMap.entries()) {
      const idx = list.findIndex((p) => p.clientMessageId === clientMessageId);
      if (idx !== -1) {
        const removed = list[idx];
        if (removed !== undefined) {
          const nextList = [...list.slice(0, idx), ...list.slice(idx + 1)];
          setPendingForConversation(convId, nextList);
          return removed;
        }
      }
    }
    return null;
  }

  function findPendingMessage(clientMessageId: string): PendingMessage | null {
    for (const list of pendingMap.values()) {
      const found = list.find((p) => p.clientMessageId === clientMessageId);
      if (found) return found;
    }
    return null;
  }

  function startAckTimeout(clientMessageId: string): void {
    clearAckTimer(clientMessageId);
    const handle = timers.setTimeout(() => {
      ackTimers.delete(clientMessageId);
      if (state === 'ready' && socket) {
        // Quá ACK_TIMEOUT_MS mà chưa có ack khi đang ready -> ngắt kết nối để nối lại và gửi lại
        dropSocket(CLOSE_CODE_CLIENT_TIMEOUT, 'ACK_TIMEOUT');
      }
    }, ACK_TIMEOUT_MS);
    ackTimers.set(clientMessageId, handle);
  }

  function sendPendingFrame(pending: PendingMessage): void {
    if (socket && state === 'ready') {
      safeSend(socket, {
        type: 'message.send',
        conversationId: pending.conversationId,
        clientMessageId: pending.clientMessageId,
        body: pending.body,
      });
      startAckTimeout(pending.clientMessageId);
    }
  }

  function sendAllPendingForRoom(conversationId: string): void {
    const list = pendingMap.get(conversationId);
    if (!list || list.length === 0) return;
    const sendings = list.filter((p) => p.status === 'sending').sort((a, b) => a.createdAt - b.createdAt);
    for (const p of sendings) {
      sendPendingFrame(p);
    }
  }

  function resetHeartbeatTimeout(): void {
    if (heartbeatTimeoutHandle !== null) {
      timers.clearTimeout(heartbeatTimeoutHandle);
      heartbeatTimeoutHandle = null;
    }
    heartbeatTimeoutHandle = timers.setTimeout(() => {
      // Quá WS_HEARTBEAT_TIMEOUT_SECONDS không nhận được frame nào từ server -> đóng kết nối
      dropSocket(WS_CLOSE_CODES.HEARTBEAT_TIMEOUT, 'HEARTBEAT_TIMEOUT');
    }, WS_HEARTBEAT_TIMEOUT_SECONDS * 1_000);
  }

  function startHeartbeat(): void {
    clearHeartbeatTimers();
    resetHeartbeatTimeout();
    const scheduleNextPing = () => {
      pingTimerHandle = timers.setTimeout(() => {
        if (state === 'ready' && socket) {
          safeSend(socket, { type: 'ping' });
          scheduleNextPing();
        }
      }, WS_HEARTBEAT_INTERVAL_SECONDS * 1_000);
    };
    scheduleNextPing();
  }

  function calculateBackoffDelay(n: number): number {
    const base = Math.min(30_000, 1_000 * Math.pow(2, n));
    const rand = random();
    const jitter = 0.5 + 0.5 * rand;
    return Math.round(base * jitter);
  }

  function scheduleReconnect(): void {
    clearReconnectTimer();
    clearHeartbeatTimers();
    clearAllAckTimers();
    setState('reconnecting');
    const delay = calculateBackoffDelay(reconnectAttempt);
    reconnectAttempt++;
    reconnectTimerHandle = timers.setTimeout(() => {
      reconnectTimerHandle = null;
      void doConnect();
    }, delay);
  }

  function removeRoomAndFailPending(
    conversationId: string,
    code: string,
    meta?: Readonly<Record<string, unknown>> | undefined,
  ): void {
    joinedRooms.delete(conversationId);
    confirmedRooms.delete(conversationId);

    const list = pendingMap.get(conversationId);
    if (list && list.length > 0) {
      let changed = false;
      const nextList = list.map((p) => {
        clearAckTimer(p.clientMessageId);
        if (p.status !== 'failed' || p.error?.code !== code) {
          changed = true;
          return {
            clientMessageId: p.clientMessageId,
            conversationId: p.conversationId,
            body: p.body,
            createdAt: p.createdAt,
            status: 'failed' as const,
            error: {
              code,
              ...(meta !== undefined ? { meta } : {}),
            },
          };
        }
        return p;
      });
      if (changed) {
        setPendingForConversation(conversationId, nextList);
        emit({ type: 'pending', conversationId });
      }
    }

    emit({ type: 'conversation-error', conversationId, code });
  }

  function handleErrorFrame(event: {
    code: string;
    clientMessageId?: string | undefined;
    conversationId?: string | undefined;
    meta?: Readonly<Record<string, unknown>> | undefined;
  }): void {
    const isParticipantOrNotFound =
      event.code === 'NOT_PARTICIPANT' || event.code === 'NOT_FOUND' || event.code === 'INVALID_ID';

    if (event.clientMessageId) {
      const clientMessageId = event.clientMessageId;
      clearAckTimer(clientMessageId);
      const found = findPendingMessage(clientMessageId);
      if (found) {
        const convId = found.conversationId;
        const list = pendingMap.get(convId) ?? [];
        const nextList = list.map((p) => {
          if (p.clientMessageId === clientMessageId) {
            return {
              clientMessageId: p.clientMessageId,
              conversationId: p.conversationId,
              body: p.body,
              createdAt: p.createdAt,
              status: 'failed' as const,
              error: {
                code: event.code,
                ...(event.meta !== undefined ? { meta: event.meta } : {}),
              },
            };
          }
          return p;
        });
        setPendingForConversation(convId, nextList);
        emit({ type: 'pending', conversationId: convId });

        if (event.code === 'CONVERSATION_CLOSED') {
          emit({ type: 'conversation-error', conversationId: convId, code: event.code });
        }
      }

      if (isParticipantOrNotFound) {
        const targetConvId = event.conversationId ?? found?.conversationId;
        if (targetConvId) {
          removeRoomAndFailPending(targetConvId, event.code, event.meta);
        }
      }
    } else if (event.conversationId) {
      if (isParticipantOrNotFound) {
        removeRoomAndFailPending(event.conversationId, event.code, event.meta);
      }
    }
  }

  function handleMessage(ws: WebSocketLike, data: unknown): void {
    if (typeof data !== 'string') {
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      // Dữ liệu không phải JSON hợp lệ → bỏ qua im lặng
      return;
    }
    const parsed = wsServerEventSchema.safeParse(json);
    if (!parsed.success) {
      // Dữ liệu sai schema → bỏ qua im lặng
      return;
    }

    resetHeartbeatTimeout();
    const event = parsed.data;

    switch (event.type) {
      case 'ready': {
        clearConnectTimer();
        setState('ready');
        reconnectAttempt = 0;
        hasRefreshedSinceLastReady = false;
        startHeartbeat();
        for (const roomId of joinedRooms) {
          safeSend(ws, { type: 'conversation.join', conversationId: roomId });
        }
        break;
      }
      case 'conversation.joined': {
        // Đã rời phòng trong lúc chờ xác nhận → bỏ qua.
        if (!joinedRooms.has(event.conversationId)) break;
        emit({ type: 'joined', conversationId: event.conversationId, status: event.status });
        if (event.status === 'CLOSED') {
          const list = pendingMap.get(event.conversationId);
          if (list && list.length > 0) {
            let hasChange = false;
            const nextList = list.map((p) => {
              if (p.status === 'sending') {
                hasChange = true;
                clearAckTimer(p.clientMessageId);
                return {
                  clientMessageId: p.clientMessageId,
                  conversationId: p.conversationId,
                  body: p.body,
                  createdAt: p.createdAt,
                  status: 'failed' as const,
                  error: { code: 'CONVERSATION_CLOSED' },
                };
              }
              return p;
            });
            if (hasChange) {
              setPendingForConversation(event.conversationId, nextList);
              emit({ type: 'pending', conversationId: event.conversationId });
            }
          }
        } else {
          confirmedRooms.add(event.conversationId);
          sendAllPendingForRoom(event.conversationId);
        }
        break;
      }
      case 'message.ack': {
        clearAckTimer(event.clientMessageId);
        const removed = removePendingMessage(event.clientMessageId);
        if (removed) {
          emit({ type: 'pending', conversationId: removed.conversationId });
        }
        emit({ type: 'message', message: event.message });
        break;
      }
      case 'message.new': {
        if (event.message.clientMessageId) {
          clearAckTimer(event.message.clientMessageId);
          const removed = removePendingMessage(event.message.clientMessageId);
          if (removed) {
            emit({ type: 'pending', conversationId: removed.conversationId });
          }
        }
        emit({ type: 'message', message: event.message });
        break;
      }
      case 'message.read': {
        emit({
          type: 'read',
          conversationId: event.conversationId,
          readerId: event.readerId,
          messageId: event.messageId,
          readAt: event.readAt,
        });
        break;
      }
      case 'pong': {
        break;
      }
      case 'typing': {
        break;
      }
      case 'error': {
        handleErrorFrame(event);
        break;
      }
    }
  }

  function handleClose(code: number, generation: number): void {
    socket = null;
    clearConnectTimer();
    clearHeartbeatTimers();
    clearAllAckTimers();
    confirmedRooms.clear();

    if (code === WS_CLOSE_CODES.UNAUTHENTICATED) {
      if (!hasRefreshedSinceLastReady) {
        hasRefreshedSinceLastReady = true;
        setState('reconnecting');
        void (async () => {
          try {
            await options.refreshSession();
            if (generation !== currentGeneration) return;
            void doConnect();
          } catch (err: unknown) {
            if (generation !== currentGeneration) return;
            if (
              typeof err === 'object' &&
              err !== null &&
              'status' in err &&
              (err as { status: unknown }).status === 401
            ) {
              setState('signed_out');
              return;
            }
            scheduleReconnect();
          }
        })();
        return;
      }
      // Lại đóng 4401 trước khi từng 'ready' kể từ lần refresh → theo backoff (không lặp tức thì). Lần nối sau được phép
      // refresh lại: token có thể hết hạn trong lúc mất mạng lâu.
      hasRefreshedSinceLastReady = false;
      scheduleReconnect();
      return;
    }

    scheduleReconnect();
  }

  async function doConnect(): Promise<void> {
    clearReconnectTimer();
    clearConnectTimer();
    clearHeartbeatTimers();
    clearAllAckTimers();
    confirmedRooms.clear();

    const generation = ++currentGeneration;

    let token: string | null = null;
    try {
      token = await options.getAccessToken();
    } catch {
      if (generation !== currentGeneration) return;
      scheduleReconnect();
      return;
    }

    if (generation !== currentGeneration) {
      return;
    }

    if (token === null) {
      setState('signed_out');
      return;
    }

    setState('connecting');

    let ws: WebSocketLike;
    try {
      ws = options.createWebSocket(options.url, {
        authorization: `Bearer ${token}`,
      });
    } catch {
      if (generation !== currentGeneration) return;
      scheduleReconnect();
      return;
    }

    socket = ws;
    connectTimerHandle = timers.setTimeout(() => {
      connectTimerHandle = null;
      if (generation === currentGeneration) dropSocket(CLOSE_CODE_CLIENT_TIMEOUT, 'CONNECT_TIMEOUT');
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (generation !== currentGeneration) return;
      // Chờ frame 'ready' từ server mới xác nhận trạng thái 'ready'
    };

    ws.onmessage = (ev) => {
      if (generation !== currentGeneration) return;
      handleMessage(ws, ev.data);
    };

    ws.onclose = (ev) => {
      if (generation !== currentGeneration) return;
      handleClose(ev.code, generation);
    };

    ws.onerror = () => {
      if (generation !== currentGeneration) return;
      // Sự kiện lỗi kết nối sẽ được kích hoạt xử lý qua onclose
    };
  }

  function connect(): void {
    if (state === 'connecting' || state === 'ready' || state === 'reconnecting') {
      return;
    }
    void doConnect();
  }

  function disconnect(): void {
    currentGeneration++;
    reconnectAttempt = 0;
    hasRefreshedSinceLastReady = false;
    clearReconnectTimer();
    clearConnectTimer();
    clearHeartbeatTimers();
    clearAllAckTimers();

    if (socket) {
      const ws = socket;
      socket = null;
      detach(ws);
      ws.close(1000, 'DISCONNECT');
    }

    joinedRooms.clear();
    confirmedRooms.clear();
    const conversationsWithPending = [...pendingMap.keys()];
    pendingMap.clear();
    for (const conversationId of conversationsWithPending) emit({ type: 'pending', conversationId });

    setState('idle');
  }

  function reconnectNow(): void {
    if (state === 'idle' || state === 'ready' || state === 'connecting' || state === 'signed_out') {
      return;
    }
    if (reconnectTimerHandle !== null) {
      clearReconnectTimer();
      reconnectAttempt = 0;
      void doConnect();
    }
  }

  function join(id: string): void {
    joinedRooms.add(id);
    if (state === 'ready' && socket) {
      safeSend(socket, { type: 'conversation.join', conversationId: id });
    }
  }

  function leave(id: string): void {
    joinedRooms.delete(id);
    confirmedRooms.delete(id);
    if (state === 'ready' && socket) {
      safeSend(socket, { type: 'conversation.leave', conversationId: id });
    }
  }

  function send(conversationId: string, body: string): string {
    if (!joinedRooms.has(conversationId)) {
      join(conversationId);
    }

    const clientMessageId = createId();
    const pending: PendingMessage = {
      clientMessageId,
      conversationId,
      body,
      createdAt: now(),
      status: 'sending',
    };

    addPendingMessage(pending);

    if (state === 'ready' && confirmedRooms.has(conversationId)) {
      sendPendingFrame(pending);
    }

    return clientMessageId;
  }

  function retry(clientMessageId: string): void {
    const found = findPendingMessage(clientMessageId);
    if (!found || found.status !== 'failed') {
      return;
    }

    const convId = found.conversationId;
    const list = pendingMap.get(convId) ?? [];
    let updatedMessage: PendingMessage | null = null;
    const nextList = list.map((p) => {
      if (p.clientMessageId === clientMessageId) {
        updatedMessage = {
          clientMessageId: p.clientMessageId,
          conversationId: p.conversationId,
          body: p.body,
          createdAt: p.createdAt,
          status: 'sending' as const,
        };
        return updatedMessage;
      }
      return p;
    });

    setPendingForConversation(convId, nextList);
    emit({ type: 'pending', conversationId: convId });

    if (!joinedRooms.has(convId)) {
      join(convId);
    }

    if (updatedMessage && state === 'ready' && confirmedRooms.has(convId)) {
      sendPendingFrame(updatedMessage);
    }
  }

  function discard(clientMessageId: string): void {
    clearAckTimer(clientMessageId);
    const removed = removePendingMessage(clientMessageId);
    if (removed) {
      emit({ type: 'pending', conversationId: removed.conversationId });
    }
  }

  function confirm(messages: readonly ConversationMessageDto[]): void {
    const affectedConvs = new Set<string>();
    for (const msg of messages) {
      if (msg.clientMessageId) {
        clearAckTimer(msg.clientMessageId);
        const removed = removePendingMessage(msg.clientMessageId);
        if (removed) {
          affectedConvs.add(removed.conversationId);
        }
      }
    }
    for (const convId of affectedConvs) {
      emit({ type: 'pending', conversationId: convId });
    }
  }

  function getState(): ChatConnectionState {
    return state;
  }

  function getPending(conversationId: string): readonly PendingMessage[] {
    return pendingMap.get(conversationId) ?? EMPTY_PENDING;
  }

  function subscribe(listener: (e: ChatClientEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    connect,
    disconnect,
    reconnectNow,
    join,
    leave,
    send,
    retry,
    discard,
    confirm,
    getState,
    getPending,
    subscribe,
  };
}
