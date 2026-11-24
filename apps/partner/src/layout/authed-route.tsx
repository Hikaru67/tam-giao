import { createRoute, Outlet, redirect } from '@tanstack/react-router';
import { isApiError } from '@tamgiao/api-client';
import { partnerMeQueryOptions } from '../features/auth/partner-auth-api';
import { rootRoute } from '../routes/root-route';

export const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authed',
  beforeLoad: async ({ context, location }) => {
    const token = await context.tokenStore.getAccessToken();
    if (!token) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    try {
      const me = await context.queryClient.ensureQueryData(partnerMeQueryOptions(context.apiClient));
      return { me };
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        await context.tokenStore.clear();
        throw redirect({ to: '/login', search: { redirect: location.href } });
      }
      throw error;
    }
  },
  component: Outlet,
});
