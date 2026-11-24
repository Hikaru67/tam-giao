import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { MODERATION_COPY } from '../../features/moderation/copy';

export function ModerationLayout() {
  const location = useLocation();
  const isFlaggedTab = location.pathname.startsWith('/moderation/flagged');

  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <h1 className="text-headline-md font-bold text-on-surface">{MODERATION_COPY.title}</h1>
        <p className="text-body-md text-secondary mt-space-xs">{MODERATION_COPY.subtitle}</p>
      </div>

      <div className="flex border-b border-surface-container-high gap-space-md">
        <Link
          to="/moderation"
          className={`pb-space-sm font-semibold text-body-md border-b-2 transition-colors ${
            !isFlaggedTab
              ? 'border-primary text-primary'
              : 'border-transparent text-secondary hover:text-on-surface'
          }`}
        >
          {MODERATION_COPY.tabs.reports}
        </Link>
        <Link
          to="/moderation/flagged"
          className={`pb-space-sm font-semibold text-body-md border-b-2 transition-colors ${
            isFlaggedTab
              ? 'border-primary text-primary'
              : 'border-transparent text-secondary hover:text-on-surface'
          }`}
        >
          {MODERATION_COPY.tabs.flagged}
        </Link>
      </div>

      <Outlet />
    </div>
  );
}
