import { createRoute, redirect } from '@tanstack/react-router';
import { adminMeQueryOptions } from '../features/auth/admin-auth-api';
import { LoginPage } from '../features/auth/login-page';
import { parseLoginSearch, safeRedirectTarget } from '../features/auth/login-search';
import { rootRoute } from './root-route';

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: parseLoginSearch,
  beforeLoad: async ({ context, search }) => {
    const token = await context.tokenStore.getAccessToken();
    if (!token) return;
    let shouldRedirect = false;
    try {
      await context.queryClient.ensureQueryData(adminMeQueryOptions(context.apiClient));
      shouldRedirect = true;
    } catch {
      // lỗi -> ở lại màn login
    }
    if (shouldRedirect) {
      throw redirect({ href: safeRedirectTarget(search) });
    }
  },
  component: LoginPage,
});
