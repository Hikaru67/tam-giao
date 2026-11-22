import { Link, useRouteContext } from '@tanstack/react-router';
import { Card } from '@tamgiao/ui-web';
import { OVERVIEW_COPY, ROLE_LABELS } from '../../layout/copy';
import { visibleNavItems } from '../../layout/navigation';
import { NavIcon } from '../../layout/nav-icon';

export function OverviewPage() {
  const me = useRouteContext({ from: '/_authed', select: (c) => c.me });
  const sections = visibleNavItems(me.permissions).filter((item) => item.id !== 'overview');

  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <h1 className="text-headline-md font-bold text-on-surface">{OVERVIEW_COPY.title}</h1>
        <p className="text-body-md text-secondary mt-space-xs">
          {OVERVIEW_COPY.rolePrefix}{' '}
          <span className="font-semibold text-on-surface">{ROLE_LABELS[me.role]}</span>.
        </p>
      </div>

      <div className="flex flex-col gap-space-md">
        <h2 className="text-title-md font-semibold text-on-surface">{OVERVIEW_COPY.sectionsTitle}</h2>
        {sections.length === 0 ? (
          <p className="text-body-md text-secondary">{OVERVIEW_COPY.noSections}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-gutter">
            {sections.map((item) => (
              <Card key={item.id} className="hover:border-primary transition-colors">
                <Link to={item.to} className="flex items-center gap-space-md p-space-sm">
                  <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
                    <NavIcon name={item.icon} />
                  </div>
                  <div>
                    <div className="font-semibold text-title-md text-on-surface">{item.label}</div>
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
