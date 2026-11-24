import { Card } from '@tamgiao/ui-web';
import { MODERATION_COPY } from '../../features/moderation/copy';

export function ModerationFlaggedPlaceholderPage() {
  return (
    <Card className="p-space-xl flex flex-col items-center justify-center text-center">
      <p className="text-body-md text-secondary">{MODERATION_COPY.flagged.placeholder}</p>
    </Card>
  );
}
