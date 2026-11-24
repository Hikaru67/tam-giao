import { createRoute } from '@tanstack/react-router';
import { requirePermission } from '../../features/auth/permissions';
import { authedRoute } from '../../layout/authed-route';
import { ModerationLayout } from './moderation-layout';
import { ModerationReportsPage } from './moderation-reports-page';
import { ModerationReportsPlaceholderPage } from './moderation-reports-placeholder-page';
import { ModerationReportsDetailPage } from './moderation-reports-detail-page';
import { ModerationFlaggedPage } from './moderation-flagged-page';
import { ModerationFlaggedPlaceholderPage } from './moderation-flagged-placeholder-page';
import { ModerationFlaggedDetailPage } from './moderation-flagged-detail-page';

/** Khung chính kiểm duyệt /moderation: guard 'safety:ban', tab 'Báo cáo vi phạm' / 'Tin nhắn cảnh báo'. */
export const moderationRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/moderation',
  beforeLoad: requirePermission('safety:ban'),
  component: ModerationLayout,
});

/** Tab Báo cáo: khung không có path riêng (hàng chờ + `<Outlet/>`), con là `/moderation` và `/moderation/reports/…`. */
export const moderationReportsRoute = createRoute({
  getParentRoute: () => moderationRoute,
  id: '_reports',
  component: ModerationReportsPage,
});

export const moderationReportsPlaceholderRoute = createRoute({
  getParentRoute: () => moderationReportsRoute,
  path: '/',
  component: ModerationReportsPlaceholderPage,
});

export const moderationReportsDetailRoute = createRoute({
  getParentRoute: () => moderationReportsRoute,
  path: 'reports/$reportId',
  component: ModerationReportsDetailPage,
});

/** Tab Tin gắn cờ: route /moderation/flagged */
export const moderationFlaggedRoute = createRoute({
  getParentRoute: () => moderationRoute,
  path: 'flagged',
  component: ModerationFlaggedPage,
});

export const moderationFlaggedPlaceholderRoute = createRoute({
  getParentRoute: () => moderationFlaggedRoute,
  path: '/',
  component: ModerationFlaggedPlaceholderPage,
});

export const moderationFlaggedDetailRoute = createRoute({
  getParentRoute: () => moderationFlaggedRoute,
  path: '$messageId',
  component: ModerationFlaggedDetailPage,
});

export const moderationRouteTree = moderationRoute.addChildren([
  moderationReportsRoute.addChildren([moderationReportsPlaceholderRoute, moderationReportsDetailRoute]),
  moderationFlaggedRoute.addChildren([moderationFlaggedPlaceholderRoute, moderationFlaggedDetailRoute]),
]);
