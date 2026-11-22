import { Outlet, Link, useRouteContext } from '@tanstack/react-router';
import { Button } from '@tamgiao/ui-web';
import { SHELL_COPY, ROLE_LABELS } from './copy';
import { visibleNavItems } from './navigation';
import { NavIcon } from './nav-icon';
import { useAdminLogout } from '../features/auth/use-admin-auth';

export function AdminShell() {
  const me = useRouteContext({
    from: '/_authed',
    select: (c) => c.me,
  });
  const logoutMutation = useAdminLogout();

  return (
    <div className="min-h-screen bg-surface flex">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 bottom-0 w-64 bg-surface-container-lowest border-r border-surface-container-high flex flex-col justify-between z-30">
        <div className="flex flex-col">
          {/* Logo brand */}
          <div className="p-space-md border-b border-surface-container-high flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary shrink-0 shadow-sm">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-title-md text-on-surface leading-tight">
                {SHELL_COPY.brand}
              </span>
              <span className="text-body-sm text-secondary truncate">{SHELL_COPY.portalName}</span>
            </div>
          </div>

          {/* Navigation */}
          <nav aria-label={SHELL_COPY.navLabel} className="p-space-sm flex flex-col gap-space-xs">
            {visibleNavItems(me.permissions).map((item) => (
              <Link
                key={item.id}
                to={item.to}
                {...(item.to === '/' ? { activeOptions: { exact: true } } : {})}
                activeProps={{
                  className: 'bg-primary-fixed text-on-primary-fixed font-semibold',
                }}
                className="flex items-center gap-space-sm px-space-md py-space-sm rounded-lg text-secondary hover:bg-surface-container hover:text-on-surface transition-colors font-medium text-label-md"
              >
                <NavIcon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content area */}
      <div className="pl-64 flex-1 flex flex-col min-h-screen">
        {/* Header */}
        <header className="h-16 border-b border-surface-container-high bg-surface-container-lowest px-gutter-desktop flex items-center justify-end gap-space-md sticky top-0 z-20">
          <span className="text-label-md text-on-surface font-medium">{ROLE_LABELS[me.role]}</span>
          <Button
            variant="ghost"
            size="md"
            loading={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            {SHELL_COPY.logout}
          </Button>
        </header>

        {/* Content */}
        <main className="flex-1 p-gutter-desktop">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
