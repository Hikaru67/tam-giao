import { createChatClient, type ChatClient, type WebSocketLike } from '@tamgiao/api-client/ws';
import { MOBILE_ENV } from '../../env.js';
import { apiClient, tokenStore } from '../../session/api.js';

const ReactNativeWebSocket = WebSocket as unknown as new (
  url: string,
  protocols: string | string[] | undefined | null,
  options: { headers: Record<string, string> },
) => WebSocketLike;

export function createMobileChatClient(): ChatClient {
  return createChatClient({
    url: MOBILE_ENV.wsUrl,
    getAccessToken: () => tokenStore.getAccessToken(),
    refreshSession: async () => {
      await apiClient.get('/me');
    },
    createWebSocket: (url: string, headers: Readonly<Record<string, string>>) => {
      return new ReactNativeWebSocket(url, null, { headers: { ...headers } });
    },
  });
}
