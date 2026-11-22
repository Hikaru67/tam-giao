import type { QueryClient } from '@tanstack/react-query';
import type { ApiClient } from '@tamgiao/api-client';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { AdminTokenStore } from '../features/auth/session-token-store';

export interface AdminRouterContext {
  queryClient: QueryClient;
  apiClient: ApiClient;
  tokenStore: AdminTokenStore;
}

export const rootRoute = createRootRouteWithContext<AdminRouterContext>()({
  component: Outlet,
});
