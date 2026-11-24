import { useParams } from '@tanstack/react-router';
import { PartnerDetailPanel } from '../../features/partners/partner-detail-panel';

export function PartnerDetailPage() {
  const { partnerId } = useParams({ from: '/_authed/partners/$partnerId' });
  return <PartnerDetailPanel key={partnerId} partnerId={partnerId} />;
}
