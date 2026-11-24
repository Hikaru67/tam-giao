import { createRoute, redirect } from '@tanstack/react-router';
import { LoginPage } from '../features/auth/login-page';
import { rootRoute } from './root-route';

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: async ({ context }) => {
    const token = await context.tokenStore.getAccessToken();
    if (token) {
      throw redirect({ to: '/' });
    }
  },
  component: LoginPage,
});
