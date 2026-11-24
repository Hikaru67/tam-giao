import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { rootRoute, type AdminRouterContext } from './routes/root-route';
import { loginRoute } from './routes/login-route';
import { authedRoute } from './layout/authed-route';
import { overviewRoute } from './routes/overview/overview-route';
import { kycRouteTree } from './routes/kyc/kyc-route';
import { interviewsRoute } from './routes/interviews/interviews-route';
import { matchingRouteTree } from './routes/matching/matching-route';
import { moderationRouteTree } from './routes/moderation/moderation-route';
import { partnersRouteTree } from './routes/partners/partners-route';
import { auditRoute } from './routes/audit/audit-route';
import { RouteError } from './layout/route-error';
import { NotFoundPage } from './layout/not-found-page';

export type { AdminRouterContext } from './routes/root-route';

export function createAdminRouter(options: { context: AdminRouterContext; history?: RouterHistory }) {
  const routeTree = rootRoute.addChildren([
    loginRoute,
    authedRoute.addChildren([
      overviewRoute,
      kycRouteTree,
      interviewsRoute,
      matchingRouteTree,
      moderationRouteTree,
      partnersRouteTree,
      auditRoute,
    ]),
  ]);

  return createRouter({
    routeTree,
    context: options.context,
    ...(options.history ? { history: options.history } : {}),
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFoundPage,
    defaultPreload: false,
  });
}

export type AdminRouter = ReturnType<typeof createAdminRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AdminRouter;
  }
}
