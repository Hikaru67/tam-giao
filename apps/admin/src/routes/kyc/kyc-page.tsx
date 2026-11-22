import { Outlet } from '@tanstack/react-router';
import { KYC_COPY } from '../../features/kyc/copy';
import { KycQueuePanel } from '../../features/kyc/kyc-queue-panel';

export function KycPage() {
  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <h1 className="text-headline-md font-bold text-on-surface">{KYC_COPY.title}</h1>
        <p className="text-body-md text-secondary mt-space-xs">{KYC_COPY.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,400px)_1fr] gap-space-lg items-start">
        <KycQueuePanel />
        <Outlet />
      </div>
    </div>
  );
}
