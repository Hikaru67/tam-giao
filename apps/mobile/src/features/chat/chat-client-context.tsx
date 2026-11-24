import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { ChatClient, ChatConnectionState, PendingMessage } from '@tamgiao/api-client/ws';

const ChatClientContext = createContext<ChatClient | null>(null);

export interface ChatClientProviderProps {
  client: ChatClient;
  children: ReactNode;
}

export function ChatClientProvider({ client, children }: ChatClientProviderProps) {
  useEffect(() => {
    client.connect();

    const subscription = AppState.addEventListener('change', (nextStatus: AppStateStatus) => {
      if (nextStatus === 'active') {
        client.reconnectNow();
      }
    });

    return () => {
      subscription.remove();
      client.disconnect();
    };
  }, [client]);

  return <ChatClientContext.Provider value={client}>{children}</ChatClientContext.Provider>;
}

export function useChatClient(): ChatClient {
  const client = useContext(ChatClientContext);
  if (!client) {
    throw new Error('useChatClient phải dùng bên trong <ChatClientProvider>');
  }
  return client;
}

export function useChatConnectionState(): ChatConnectionState {
  const client = useChatClient();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return client.subscribe((event) => {
        if (event.type === 'state') {
          onStoreChange();
        }
      });
    },
    [client],
  );
  const getSnapshot = useCallback(() => client.getState(), [client]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePendingMessages(conversationId: string): readonly PendingMessage[] {
  const client = useChatClient();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return client.subscribe((event) => {
        if (event.type === 'pending' && event.conversationId === conversationId) {
          onStoreChange();
        }
      });
    },
    [client, conversationId],
  );
  const getSnapshot = useCallback(() => client.getPending(conversationId), [client, conversationId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
