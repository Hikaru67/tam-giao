import { createRoute } from '@tanstack/react-router';
import { requirePermission } from '../../features/auth/permissions';
import { authedRoute } from '../../layout/authed-route';
import { KycDetailPage } from './kyc-detail-page';
import { KycIndexPage } from './kyc-index-page';
import { KycPage } from './kyc-page';

/** Khung màn thẩm định: hàng chờ bên trái + `<Outlet/>` panel chi tiết bên phải. */
export const kycRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/kyc',
  beforeLoad: requirePermission('kyc:review'),
  component: KycPage,
});

/** `/kyc` — chưa chọn hồ sơ. */
export const kycIndexRoute = createRoute({
  getParentRoute: () => kycRoute,
  path: '/',
  component: KycIndexPage,
});

/** `/kyc/$submissionId` — chi tiết + thanh quyết định. */
export const kycDetailRoute = createRoute({
  getParentRoute: () => kycRoute,
  path: '$submissionId',
  component: KycDetailPage,
});

export const kycRouteTree = kycRoute.addChildren([kycIndexRoute, kycDetailRoute]);
