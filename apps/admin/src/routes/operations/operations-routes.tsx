import { createRoute } from '@tanstack/react-router';
import { requirePermission } from '../../features/auth/permissions';
import { authedRoute } from '../../layout/authed-route';
import { AppearanceFlagsPage } from './appearance-flags-page';
import { AppearanceFlagsPlaceholderPage } from './appearance-flags-placeholder-page';
import { FeedbackDetailPage } from './feedback-detail-page';
import { RefundsPage } from './refunds-page';
import { ReconciliationPage } from './reconciliation-page';

export const appearanceFlagsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/operations/appearance-flags',
  beforeLoad: requirePermission('kyc:review'),
  component: AppearanceFlagsPage,
});

export const appearanceFlagsPlaceholderRoute = createRoute({
  getParentRoute: () => appearanceFlagsRoute,
  path: '/',
  component: AppearanceFlagsPlaceholderPage,
});

export const appearanceFlagsDetailRoute = createRoute({
  getParentRoute: () => appearanceFlagsRoute,
  path: '$feedbackId',
  component: FeedbackDetailPage,
});

export const appearanceFlagsRouteTree = appearanceFlagsRoute.addChildren([
  appearanceFlagsPlaceholderRoute,
  appearanceFlagsDetailRoute,
]);

export const refundsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/operations/refunds',
  beforeLoad: requirePermission('billing:refund'),
  component: RefundsPage,
});

export const reconciliationRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/operations/reconciliation',
  beforeLoad: requirePermission('billing:refund'),
  component: ReconciliationPage,
});

export const operationsRoutes = [appearanceFlagsRouteTree, refundsRoute, reconciliationRoute];
