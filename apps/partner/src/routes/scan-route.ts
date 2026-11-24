import { createRoute } from '@tanstack/react-router';
import { ScanPage } from '../features/scan/scan-page';
import { authedRoute } from '../layout/authed-route';

export const scanRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: ScanPage,
});
