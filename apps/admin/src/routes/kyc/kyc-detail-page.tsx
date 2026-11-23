import { useParams } from '@tanstack/react-router';
import { KycDetailPanel } from '../../features/kyc/kyc-detail-panel';

export function KycDetailPage() {
  const { submissionId } = useParams({ from: '/_authed/kyc/$submissionId' });
  return <KycDetailPanel key={submissionId} submissionId={submissionId} />;
}
