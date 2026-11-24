import { Outlet } from '@tanstack/react-router';
import { FlaggedListPanel } from '../../features/moderation/flagged-list-panel';

export function ModerationFlaggedPage() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,400px)_1fr] gap-space-lg items-start">
      <FlaggedListPanel />
      <Outlet />
    </div>
  );
}
