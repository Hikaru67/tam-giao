import { createRoute } from '@tanstack/react-router';
import { requirePermission } from '../../features/auth/permissions';
import { authedRoute } from '../../layout/authed-route';
import { KycPage } from './kyc-page';

export const kycRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/kyc',
  beforeLoad: requirePermission('kyc:review'),
  component: KycPage,
});
