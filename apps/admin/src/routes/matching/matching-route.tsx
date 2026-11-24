import { createRoute } from '@tanstack/react-router';
import { requirePermission } from '../../features/auth/permissions';
import { authedRoute } from '../../layout/authed-route';
import { isUuid, normalizeUserId } from '../../features/matching/user-id';
import { MatchingBoardPage } from './matching-board-page';
import { MatchingPage } from './matching-page';
import { MatchingProposePage } from './matching-propose-page';

export const matchingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/matching',
  beforeLoad: requirePermission('match:propose'),
  component: MatchingPage,
});

export const matchingBoardRoute = createRoute({
  getParentRoute: () => matchingRoute,
  path: '/',
  component: MatchingBoardPage,
});

export interface MatchingProposeSearch {
  readonly userId?: string;
}

export const matchingProposeRoute = createRoute({
  getParentRoute: () => matchingRoute,
  path: 'propose',
  validateSearch: (search: Record<string, unknown>): MatchingProposeSearch => {
    const rawUserId = typeof search.userId === 'string' ? normalizeUserId(search.userId) : '';
    return isUuid(rawUserId) ? { userId: rawUserId } : {};
  },
  component: MatchingProposePage,
});

export const matchingRouteTree = matchingRoute.addChildren([matchingBoardRoute, matchingProposeRoute]);
