import { createContext, useContext, type ReactNode } from 'react';
import type { TokenStore } from '@tamgiao/api-client';

/**
 * Token store của phiên đăng nhập qua React context (FE-S2-01): app cấp store dùng SecureStore
 * (`session/api.ts`), test cấp store bộ nhớ — hook không phụ thuộc singleton của module.
 */
const TokenStoreContext = createContext<TokenStore | null>(null);

export function TokenStoreProvider({ store, children }: { store: TokenStore; children: ReactNode }) {
  return <TokenStoreContext.Provider value={store}>{children}</TokenStoreContext.Provider>;
}

export function useTokenStore(): TokenStore {
  const store = useContext(TokenStoreContext);
  if (!store) throw new Error('useTokenStore phải dùng bên trong <TokenStoreProvider>');
  return store;
}
