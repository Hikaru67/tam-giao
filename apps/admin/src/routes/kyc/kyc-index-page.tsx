import { Card, EmptyState } from '@tamgiao/ui-web';
import { KYC_COPY } from '../../features/kyc/copy';

export function KycIndexPage() {
  return (
    <Card>
      <EmptyState
        title={KYC_COPY.detail.placeholderTitle}
        description={KYC_COPY.detail.placeholderDescription}
      />
    </Card>
  );
}
