import { useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import type { ReportSeverityName, ReportStatusName } from '@tamgiao/contracts/safety';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState, type BadgeTone } from '@tamgiao/ui-web';
import { MODERATION_COPY } from './copy';
import { formatDateTime } from '../kyc/format';
import { reportDetailQueryOptions, useResolveReport, useStartReview } from './moderation-api';
import { EvidenceImage } from './evidence-image';
import { ResolveDialog } from './resolve-dialog';
import { BanDialog } from './ban-dialog';
import { SlaBadge } from './sla-badge';

const SEVERITY_BADGE_TONE = {
  LOW: 'neutral',
  MEDIUM: 'primary',
  HIGH: 'warning',
  CRITICAL: 'danger',
} as const satisfies Record<ReportSeverityName, BadgeTone>;

const STATUS_BADGE_TONE = {
  OPEN: 'primary',
  IN_REVIEW: 'neutral',
  RESOLVED: 'success',
  DISMISSED: 'neutral',
} as const satisfies Record<ReportStatusName, BadgeTone>;

export interface ReportDetailPanelProps {
  readonly reportId: string;
}

export function ReportDetailPanel({ reportId }: ReportDetailPanelProps) {
  const client = useApiClient();
  const query = useQuery(reportDetailQueryOptions(client, reportId));
  const startReviewMutation = useStartReview(reportId);
  const resolveMutation = useResolveReport(reportId);

  const [resolveAction, setResolveAction] = useState<'RESOLVED' | 'DISMISSED' | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);

  if (query.data === undefined && query.isLoading) {
    return (
      <Card className="p-space-lg flex justify-center">
        <div aria-busy="true" className="text-body-sm text-secondary" />
      </Card>
    );
  }

  if (query.data === undefined && query.isError) {
    return (
      <Card>
        <ErrorState
          title={messageFor(isApiError(query.error) ? query.error : { code: 'UNKNOWN' }).title}
          action={MODERATION_COPY.detail.retry}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }

  if (query.data === undefined) {
    return null;
  }

  const report = query.data;

  const handleStartReview = () => {
    setFeedback(null);
    startReviewMutation.mutate(undefined, {
      onSuccess: () => {
        setFeedback({ tone: 'success', message: MODERATION_COPY.detail.toasts.startReviewSuccess });
      },
      onError: (err) => {
        const m = messageFor(isApiError(err) ? err : { code: 'UNKNOWN' });
        setFeedback({ tone: 'danger', message: m.title });
      },
    });
  };

  const handleResolveSubmit = (conclusion: string) => {
    if (!resolveAction) return;
    setFeedback(null);
    setResolveError(null);
    const action = resolveAction;
    resolveMutation.mutate(
      {
        outcome: action,
        conclusion,
      },
      {
        onSuccess: () => {
          setResolveAction(null);
          setFeedback({
            tone: 'success',
            message:
              action === 'RESOLVED'
                ? MODERATION_COPY.detail.toasts.resolveSuccess
                : MODERATION_COPY.detail.toasts.dismissSuccess,
          });
        },
        onError: (err) => {
          const m = messageFor(isApiError(err) ? err : { code: 'UNKNOWN' });
          setResolveError(m.title);
        },
      },
    );
  };

  return (
    <Card className="flex flex-col gap-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-container-high pb-space-md">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-sm flex-wrap">
            <h2 className="text-headline-sm font-bold text-on-surface">
              {MODERATION_COPY.categories[report.category]}
            </h2>
            {report.urgent ? <Badge tone="danger">{MODERATION_COPY.queue.urgentBadge}</Badge> : null}
            <Badge tone={SEVERITY_BADGE_TONE[report.severity]}>
              {MODERATION_COPY.severities[report.severity]}
            </Badge>
            <Badge tone={STATUS_BADGE_TONE[report.status]}>{MODERATION_COPY.statuses[report.status]}</Badge>
          </div>
          <span className="text-body-sm text-secondary">
            {MODERATION_COPY.queue.createdAt}: {formatDateTime(report.createdAt)}
          </span>
        </div>

        <SlaBadge report={report} />
      </div>

      {feedback ? (
        <div
          role="alert"
          className={`p-space-sm rounded-md text-body-sm ${
            feedback.tone === 'success'
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-error-container text-on-error-container'
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md p-space-md rounded-lg bg-surface-container-low border border-surface-container-high text-body-sm">
        <div>
          <span className="font-medium text-secondary">{MODERATION_COPY.queue.reportedUser}: </span>
          <span className="font-mono text-on-surface">{report.reportedUserId}</span>
        </div>
        <div>
          <span className="font-medium text-secondary">{MODERATION_COPY.queue.reporter}: </span>
          <span className="font-mono text-on-surface">{report.reporterId}</span>
        </div>
        <div>
          <span className="font-medium text-secondary">{MODERATION_COPY.matchId}: </span>
          <span className="font-mono text-on-surface">{report.matchId}</span>
        </div>
        {report.handledBy ? (
          <div>
            <span className="font-medium text-secondary">{MODERATION_COPY.detail.handledBy}: </span>
            <span className="font-mono text-on-surface">{report.handledBy}</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-space-xs">
        <h3 className="text-title-md font-semibold text-on-surface">
          {MODERATION_COPY.detail.sectionDescription}
        </h3>
        <div className="p-space-md rounded-lg bg-surface-container-lowest border border-surface-container-high text-body-md text-on-surface whitespace-pre-wrap">
          {report.description ? (
            report.description
          ) : (
            <span className="text-secondary italic">{MODERATION_COPY.detail.noDescription}</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-space-sm">
        <h3 className="text-title-md font-semibold text-on-surface">
          {MODERATION_COPY.detail.sectionEvidence}
        </h3>
        {report.evidence.length === 0 ? (
          <p className="text-body-sm text-secondary">{MODERATION_COPY.detail.noEvidence}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-space-md">
            {report.evidence.map((item, index) => (
              <EvidenceImage
                key={item.key}
                label={MODERATION_COPY.detail.evidenceLabel(index + 1)}
                item={item}
                fetchedAt={query.dataUpdatedAt}
                onRequestNewUrl={() => void query.refetch()}
              />
            ))}
          </div>
        )}
      </div>

      {report.conclusion ? (
        <div className="flex flex-col gap-space-xs">
          <h3 className="text-title-md font-semibold text-on-surface">
            {MODERATION_COPY.detail.sectionResolution}
          </h3>
          <div className="p-space-md rounded-lg bg-surface-container-low border border-surface-container-high text-body-md text-on-surface whitespace-pre-wrap">
            {report.conclusion}
          </div>
          {report.closedAt ? (
            <span className="text-body-sm text-secondary">
              {MODERATION_COPY.detail.closedAt}: {formatDateTime(report.closedAt)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-space-sm pt-space-md border-t border-surface-container-high">
        <div className="flex gap-space-sm flex-wrap">
          {report.status === 'OPEN' ? (
            <>
              <Button variant="primary" onClick={handleStartReview} disabled={startReviewMutation.isPending}>
                {MODERATION_COPY.detail.actions.startReview}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setResolveAction('DISMISSED')}
                disabled={resolveMutation.isPending}
              >
                {MODERATION_COPY.detail.actions.dismiss}
              </Button>
            </>
          ) : report.status === 'IN_REVIEW' ? (
            <>
              <Button
                variant="primary"
                onClick={() => setResolveAction('RESOLVED')}
                disabled={resolveMutation.isPending}
              >
                {MODERATION_COPY.detail.actions.resolve}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setResolveAction('DISMISSED')}
                disabled={resolveMutation.isPending}
              >
                {MODERATION_COPY.detail.actions.dismiss}
              </Button>
            </>
          ) : null}
        </div>

        <Button variant="danger" onClick={() => setBanDialogOpen(true)}>
          {MODERATION_COPY.detail.actions.banUser}
        </Button>
      </div>

      {resolveAction ? (
        <ResolveDialog
          open={resolveAction !== null}
          outcome={resolveAction}
          pending={resolveMutation.isPending}
          error={resolveError}
          onClose={() => {
            setResolveAction(null);
            setResolveError(null);
          }}
          onSubmit={handleResolveSubmit}
        />
      ) : null}

      <BanDialog
        open={banDialogOpen}
        onClose={() => setBanDialogOpen(false)}
        userId={report.reportedUserId}
        reportId={report.reportId}
        onBanned={() => {
          setFeedback({ tone: 'success', message: MODERATION_COPY.detail.toasts.banSuccess });
        }}
      />
    </Card>
  );
}
