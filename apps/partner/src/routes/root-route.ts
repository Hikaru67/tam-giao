import type { QueryClient } from '@tanstack/react-query';
import type { ApiClient } from '@tamgiao/api-client';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { PartnerTokenStore } from '../features/auth/session-token-store';

export interface PartnerRouterContext {
  queryClient: QueryClient;
  apiClient: ApiClient;
  tokenStore: PartnerTokenStore;
}

export const rootRoute = createRootRouteWithContext<PartnerRouterContext>()({
  component: Outlet,
});
