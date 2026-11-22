import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from './client.js';

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiClientProviderProps {
  client: ApiClient;
  children: ReactNode;
}

/**
 * Provider cấp phát instance ApiClient cho toàn bộ cây component React (Web admin, Partner hoặc Mobile).
 */
export function ApiClientProvider({ client, children }: ApiClientProviderProps) {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

/**
 * Hook truy xuất ApiClient trong React component.
 * Ném lỗi rõ ràng nếu component nằm ngoài ApiClientProvider.
 */
export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error('useApiClient phải được sử dụng bên trong ApiClientProvider');
  }
  return client;
}
