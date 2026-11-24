import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { rootRoute, type PartnerRouterContext } from './routes/root-route';
import { loginRoute } from './routes/login-route';
import { authedRoute } from './layout/authed-route';
import { scanRoute } from './routes/scan-route';
import { RouteError } from './layout/route-error';

export type { PartnerRouterContext } from './routes/root-route';

export function createPartnerRouter(options: { context: PartnerRouterContext; history?: RouterHistory }) {
  const routeTree = rootRoute.addChildren([loginRoute, authedRoute.addChildren([scanRoute])]);

  return createRouter({
    routeTree,
    context: options.context,
    ...(options.history ? { history: options.history } : {}),
    defaultErrorComponent: RouteError,
    defaultPreload: false,
  });
}

export type PartnerRouter = ReturnType<typeof createPartnerRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: PartnerRouter;
  }
}
