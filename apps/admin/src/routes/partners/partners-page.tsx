import { Outlet } from '@tanstack/react-router';
import { Card, EmptyState } from '@tamgiao/ui-web';
import { PARTNERS_COPY } from '../../features/partners/copy';
import { PartnerListPanel } from '../../features/partners/partner-list-panel';

export function PartnersPage() {
  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <h1 className="text-headline-md font-bold text-on-surface">{PARTNERS_COPY.title}</h1>
        <p className="text-body-md text-secondary mt-space-xs">{PARTNERS_COPY.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,400px)_1fr] gap-space-lg items-start">
        <PartnerListPanel />
        <Outlet />
      </div>
    </div>
  );
}

export function PartnersPlaceholderPage() {
  return (
    <Card>
      <EmptyState
        title={PARTNERS_COPY.detail.placeholderTitle}
        description={PARTNERS_COPY.detail.placeholderDescription}
      />
    </Card>
  );
}
