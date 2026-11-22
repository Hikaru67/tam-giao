import { createRoute } from '@tanstack/react-router';
import { requirePermission } from '../../features/auth/permissions';
import { authedRoute } from '../../layout/authed-route';
import { InterviewsPage } from './interviews-page';

export const interviewsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/interviews',
  beforeLoad: requirePermission('kyc:review'),
  component: InterviewsPage,
});
