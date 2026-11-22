import { createApiClient, type ApiClient, type TokenStore } from '@tamgiao/api-client';
import { MOBILE_ENV } from '../env.js';
import { createSecureTokenStore } from './secure-token-store.js';

export interface SessionEvents {
  onSignedOut(listener: () => void): () => void;
  emitSignedOut(): void;
}

function createSessionEvents(): SessionEvents {
  const listeners = new Set<() => void>();

  return {
    onSignedOut(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emitSignedOut(): void {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

export const sessionEvents: SessionEvents = createSessionEvents();
export const tokenStore: TokenStore = createSecureTokenStore();

export const apiClient: ApiClient = createApiClient({
  baseUrl: MOBILE_ENV.apiUrl,
  tokenStore,
  onSignedOut: () => {
    sessionEvents.emitSignedOut();
  },
});
