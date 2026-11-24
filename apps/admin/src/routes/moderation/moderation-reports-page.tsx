import { Outlet } from '@tanstack/react-router';
import { ReportQueuePanel } from '../../features/moderation/report-queue-panel';

export function ModerationReportsPage() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,400px)_1fr] gap-space-lg items-start">
      <ReportQueuePanel />
      <Outlet />
    </div>
  );
}
