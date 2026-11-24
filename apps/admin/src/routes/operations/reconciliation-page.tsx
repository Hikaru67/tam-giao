import { RECONCILIATION_COPY } from '../../features/operations/copy';
import { ReconciliationPanel } from '../../features/operations/reconciliation-panel';

export function ReconciliationPage() {
  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <h1 className="text-headline-md font-bold text-on-surface">{RECONCILIATION_COPY.title}</h1>
        <p className="text-body-md text-secondary mt-space-xs">{RECONCILIATION_COPY.subtitle}</p>
      </div>

      <ReconciliationPanel />
    </div>
  );
}
