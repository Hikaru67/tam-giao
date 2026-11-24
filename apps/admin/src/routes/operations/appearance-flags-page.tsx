import { Outlet } from '@tanstack/react-router';
import { APPEARANCE_FLAGS_COPY } from '../../features/operations/copy';
import { AppearanceFlagsPanel } from '../../features/operations/appearance-flags-panel';

export function AppearanceFlagsPage() {
  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <h1 className="text-headline-md font-bold text-on-surface">{APPEARANCE_FLAGS_COPY.title}</h1>
        <p className="text-body-md text-secondary mt-space-xs">{APPEARANCE_FLAGS_COPY.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,400px)_1fr] gap-space-lg items-start">
        <AppearanceFlagsPanel />
        <Outlet />
      </div>
    </div>
  );
}
