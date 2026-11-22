import { createRoute } from '@tanstack/react-router';
import { requirePermission } from '../../features/auth/permissions';
import { authedRoute } from '../../layout/authed-route';
import { AuditPage } from './audit-page';

export const auditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/audit',
  beforeLoad: requirePermission('audit:read'),
  component: AuditPage,
});
