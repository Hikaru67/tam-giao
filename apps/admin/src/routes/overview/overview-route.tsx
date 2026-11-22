import { createRoute } from '@tanstack/react-router';
import { authedRoute } from '../../layout/authed-route';
import { OverviewPage } from './overview-page';

export const overviewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: OverviewPage,
});
