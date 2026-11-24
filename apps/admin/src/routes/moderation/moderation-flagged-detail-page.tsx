import { useParams } from '@tanstack/react-router';
import { FlaggedDetailPanel } from '../../features/moderation/flagged-detail-panel';

export function ModerationFlaggedDetailPage() {
  const { messageId } = useParams({ from: '/_authed/moderation/flagged/$messageId' });
  return <FlaggedDetailPanel key={messageId} messageId={messageId} />;
}
