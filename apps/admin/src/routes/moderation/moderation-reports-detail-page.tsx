import { useParams } from '@tanstack/react-router';
import { ReportDetailPanel } from '../../features/moderation/report-detail-panel';

export function ModerationReportsDetailPage() {
  const { reportId } = useParams({ from: '/_authed/moderation/_reports/reports/$reportId' });
  return <ReportDetailPanel key={reportId} reportId={reportId} />;
}
