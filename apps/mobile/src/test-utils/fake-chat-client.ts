import type {
  ChatClient,
  ChatClientEvent,
  ChatConnectionState,
  PendingMessage,
} from '@tamgiao/api-client/ws';
import type { ConversationMessageDto } from '@tamgiao/contracts/messaging';

export interface FakeChatClient extends ChatClient {
  readonly sent: Array<{ conversationId: string; body: string; clientMessageId: string }>;
  readonly retried: string[];
  readonly discarded: string[];
  readonly joined: string[];
  readonly left: string[];
  readonly confirmed: ConversationMessageDto[][];
  readonly connectedCount: number;
  readonly disconnectedCount: number;
  readonly reconnectedNowCount: number;
  emit(event: ChatClientEvent): void;
  setState(state: ChatConnectionState): void;
  setPending(conversationId: string, list: readonly PendingMessage[]): void;
}

/** Tham chiếu ổn định — `useSyncExternalStore` cần snapshot không đổi khi dữ liệu không đổi. */
const EMPTY_PENDING: readonly PendingMessage[] = [];

export function createFakeChatClient(initialState: ChatConnectionState = 'ready'): FakeChatClient {
  let state: ChatConnectionState = initialState;
  const listeners = new Set<(e: ChatClientEvent) => void>();
  const pendingMap = new Map<string, readonly PendingMessage[]>();

  const sent: Array<{ conversationId: string; body: string; clientMessageId: string }> = [];
  const retried: string[] = [];
  const discarded: string[] = [];
  const joined: string[] = [];
  const left: string[] = [];
  const confirmed: ConversationMessageDto[][] = [];
  let connectedCount = 0;
  let disconnectedCount = 0;
  let reconnectedNowCount = 0;
  let idCounter = 0;

  function emit(event: ChatClientEvent): void {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function setState(newState: ChatConnectionState): void {
    if (state !== newState) {
      state = newState;
      emit({ type: 'state', state: newState });
    }
  }

  function setPending(conversationId: string, list: readonly PendingMessage[]): void {
    if (list.length === 0) {
      pendingMap.delete(conversationId);
    } else {
      pendingMap.set(conversationId, Object.freeze([...list]));
    }
    emit({ type: 'pending', conversationId });
  }

  return {
    get sent() {
      return sent;
    },
    get retried() {
      return retried;
    },
    get discarded() {
      return discarded;
    },
    get joined() {
      return joined;
    },
    get left() {
      return left;
    },
    get confirmed() {
      return confirmed;
    },
    get connectedCount() {
      return connectedCount;
    },
    get disconnectedCount() {
      return disconnectedCount;
    },
    get reconnectedNowCount() {
      return reconnectedNowCount;
    },
    connect() {
      connectedCount++;
    },
    disconnect() {
      disconnectedCount++;
    },
    reconnectNow() {
      reconnectedNowCount++;
    },
    join(id: string) {
      joined.push(id);
    },
    leave(id: string) {
      left.push(id);
    },
    send(conversationId: string, body: string): string {
      idCounter++;
      const clientMessageId = `01890a5d-ac96-774b-bcce-b302099a${String(idCounter).padStart(4, '0')}`;
      sent.push({ conversationId, body, clientMessageId });
      const current = pendingMap.get(conversationId) ?? [];
      const newPending: PendingMessage = {
        clientMessageId,
        conversationId,
        body,
        createdAt: Date.now(),
        status: 'sending',
      };
      setPending(conversationId, [...current, newPending]);
      return clientMessageId;
    },
    retry(clientMessageId: string) {
      retried.push(clientMessageId);
      for (const [convId, list] of pendingMap.entries()) {
        const found = list.find((p) => p.clientMessageId === clientMessageId);
        if (found) {
          const updated = list.map((p) =>
            p.clientMessageId === clientMessageId
              ? {
                  clientMessageId: p.clientMessageId,
                  conversationId: p.conversationId,
                  body: p.body,
                  createdAt: p.createdAt,
                  status: 'sending' as const,
                }
              : p,
          );
          setPending(convId, updated);
          break;
        }
      }
    },
    discard(clientMessageId: string) {
      discarded.push(clientMessageId);
      for (const [convId, list] of pendingMap.entries()) {
        const idx = list.findIndex((p) => p.clientMessageId === clientMessageId);
        if (idx !== -1) {
          const updated = [...list.slice(0, idx), ...list.slice(idx + 1)];
          setPending(convId, updated);
          break;
        }
      }
    },
    confirm(messages: readonly ConversationMessageDto[]) {
      confirmed.push([...messages]);
    },
    getState(): ChatConnectionState {
      return state;
    },
    getPending(conversationId: string): readonly PendingMessage[] {
      return pendingMap.get(conversationId) ?? EMPTY_PENDING;
    },
    subscribe(listener: (e: ChatClientEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit,
    setState,
    setPending,
  };
}
