import { createContext, useContext, type ReactNode } from 'react';
import type { AdminTokenStore } from './session-token-store';

const AdminSessionContext = createContext<AdminTokenStore | null>(null);

export interface AdminSessionProviderProps {
  tokenStore: AdminTokenStore;
  children: ReactNode;
}

export function AdminSessionProvider({ tokenStore, children }: AdminSessionProviderProps) {
  return <AdminSessionContext.Provider value={tokenStore}>{children}</AdminSessionContext.Provider>;
}

export function useAdminTokenStore(): AdminTokenStore {
  const store = useContext(AdminSessionContext);
  if (!store) {
    throw new Error('useAdminTokenStore phải được sử dụng bên trong AdminSessionProvider');
  }
  return store;
}
