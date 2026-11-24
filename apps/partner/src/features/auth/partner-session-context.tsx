import { createContext, useContext, type ReactNode } from 'react';
import type { PartnerTokenStore } from './session-token-store';

const PartnerSessionContext = createContext<PartnerTokenStore | null>(null);

export interface PartnerSessionProviderProps {
  tokenStore: PartnerTokenStore;
  children: ReactNode;
}

export function PartnerSessionProvider({ tokenStore, children }: PartnerSessionProviderProps) {
  return <PartnerSessionContext.Provider value={tokenStore}>{children}</PartnerSessionContext.Provider>;
}

export function usePartnerTokenStore(): PartnerTokenStore {
  const store = useContext(PartnerSessionContext);
  if (!store) {
    throw new Error('usePartnerTokenStore phải được sử dụng bên trong PartnerSessionProvider');
  }
  return store;
}
