import { useParams } from '@tanstack/react-router';
import { FeedbackDetailPanel } from '../../features/operations/feedback-detail-panel';

export function FeedbackDetailPage() {
  const { feedbackId } = useParams({ strict: false });
  if (!feedbackId) return null;
  return <FeedbackDetailPanel key={feedbackId} feedbackId={feedbackId} />;
}
