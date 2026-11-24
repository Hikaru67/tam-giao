import { Card, EmptyState } from '@tamgiao/ui-web';
import { APPEARANCE_FLAGS_COPY } from '../../features/operations/copy';

export function AppearanceFlagsPlaceholderPage() {
  return (
    <Card>
      <EmptyState
        title={APPEARANCE_FLAGS_COPY.placeholderTitle}
        description={APPEARANCE_FLAGS_COPY.placeholderDescription}
      />
    </Card>
  );
}
