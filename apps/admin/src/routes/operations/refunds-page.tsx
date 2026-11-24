import { REFUNDS_COPY } from '../../features/operations/copy';
import { RefundPanel } from '../../features/operations/refund-panel';

export function RefundsPage() {
  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <h1 className="text-headline-md font-bold text-on-surface">{REFUNDS_COPY.title}</h1>
        <p className="text-body-md text-secondary mt-space-xs">{REFUNDS_COPY.subtitle}</p>
      </div>

      <RefundPanel />
    </div>
  );
}
