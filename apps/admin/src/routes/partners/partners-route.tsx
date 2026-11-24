import { createRoute } from '@tanstack/react-router';
import { requirePermission } from '../../features/auth/permissions';
import { authedRoute } from '../../layout/authed-route';
import { PartnersPage, PartnersPlaceholderPage } from './partners-page';
import { PartnerDetailPage } from './partner-detail-page';

export const partnersRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/partners',
  beforeLoad: requirePermission('partner:manage'),
  component: PartnersPage,
});

export const partnersIndexRoute = createRoute({
  getParentRoute: () => partnersRoute,
  path: '/',
  component: PartnersPlaceholderPage,
});

export const partnerDetailRoute = createRoute({
  getParentRoute: () => partnersRoute,
  path: '$partnerId',
  component: PartnerDetailPage,
});

export const partnersRouteTree = partnersRoute.addChildren([partnersIndexRoute, partnerDetailRoute]);
