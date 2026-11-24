import { Link, Outlet } from '@tanstack/react-router';
import { NAV_COPY } from '../../layout/copy';
import { MATCHING_COPY } from '../../features/matching/copy';

export function MatchingPage() {
  return (
    <div className="flex flex-col gap-space-lg">
      <div className="flex flex-col gap-space-xs">
        <h1 className="text-headline-md font-bold text-on-surface">{NAV_COPY.matching}</h1>
        <p className="text-body-md text-secondary">{MATCHING_COPY.subtitle}</p>
      </div>

      <nav
        aria-label={MATCHING_COPY.tabs.navLabel}
        className="flex border-b border-surface-container-high gap-space-md"
      >
        <Link
          to="/matching"
          activeOptions={{ exact: true }}
          activeProps={{
            className: 'border-b-2 border-primary text-primary font-semibold',
          }}
          inactiveProps={{
            className: 'text-secondary hover:text-on-surface font-medium',
          }}
          className="pb-space-sm px-space-xs text-body-md transition-colors"
        >
          {MATCHING_COPY.tabs.board}
        </Link>
        <Link
          to="/matching/propose"
          activeProps={{
            className: 'border-b-2 border-primary text-primary font-semibold',
          }}
          inactiveProps={{
            className: 'text-secondary hover:text-on-surface font-medium',
          }}
          className="pb-space-sm px-space-xs text-body-md transition-colors"
        >
          {MATCHING_COPY.tabs.propose}
        </Link>
      </nav>

      <Outlet />
    </div>
  );
}
