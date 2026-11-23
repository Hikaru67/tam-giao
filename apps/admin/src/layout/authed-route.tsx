import { createRoute, redirect } from '@tanstack/react-router';
import { isApiError } from '@tamgiao/api-client';
import { adminMeQueryOptions } from '../features/auth/admin-auth-api';
import { rootRoute } from '../routes/root-route';
import { AdminShell } from './admin-shell';

export const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authed',
  beforeLoad: async ({ context, location }) => {
    const token = await context.tokenStore.getAccessToken();
    if (!token) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    try {
      const me = await context.queryClient.ensureQueryData(adminMeQueryOptions(context.apiClient));
      return { me };
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        await context.tokenStore.clear();
        throw redirect({ to: '/login', search: { redirect: location.href } });
      }
      throw error;
    }
  },
  component: AdminShell,
});
