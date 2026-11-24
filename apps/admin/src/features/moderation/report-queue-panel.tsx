import { useId, useMemo, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  REPORT_STATUS_NAMES,
  type ReportSeverityName,
  type ReportStatusName,
} from '@tamgiao/contracts/safety';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Badge, Button, Card, EmptyState, ErrorState, type BadgeTone } from '@tamgiao/ui-web';
import { MODERATION_COPY } from './copy';
import { formatDateTime } from '../kyc/format';
import { reportQueueInfiniteQueryOptions } from './moderation-api';
import { SlaBadge } from './sla-badge';
import { slaState, sortQueue } from './sla';

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

/** Báo cáo còn phải xử lý — khớp mặc định của `GET /admin/reports`. */
const PENDING_STATUSES = ['OPEN', 'IN_REVIEW'] as const satisfies readonly ReportStatusName[];

export function ReportQueuePanel() {
  const client = useApiClient();
  const rawParams = useParams({ strict: false });
  const selectedReportId = 'reportId' in rawParams ? rawParams.reportId : undefined;

  const [filterMode, setFilterMode] = useState<'pending' | 'all' | ReportStatusName>('pending');
  const filterId = useId();

  const statuses: readonly ReportStatusName[] = useMemo(() => {
    if (filterMode === 'pending') return PENDING_STATUSES;
    if (filterMode === 'all') return REPORT_STATUS_NAMES;
    return [filterMode];
  }, [filterMode]);

  const { data, isLoading, isError, error, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery(reportQueueInfiniteQueryOptions(client, statuses));

  const items = useMemo(() => {
    const rawItems = data?.pages.flatMap((page) => page.items) ?? [];
    // Phân trang offset: báo cáo mới chen vào có thể làm một dòng lặp lại ở trang sau.
    const unique = [...new Map(rawItems.map((item) => [item.reportId, item])).values()];
    return sortQueue(unique);
  }, [data]);

  return (
    <Card className="flex flex-col gap-space-md">
      <h2 className="text-title-md font-bold text-on-surface">{MODERATION_COPY.queue.title}</h2>

      <div className="flex flex-col gap-space-xs">
        <label htmlFor={filterId} className="text-label-md font-medium text-on-surface">
          {MODERATION_COPY.queue.filterLabel}
        </label>
        <select
          id={filterId}
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value as 'pending' | 'all' | ReportStatusName)}
          className="min-h-[44px] px-space-md rounded-md bg-surface-container-lowest text-on-surface text-body-md border border-outline-variant focus:border-primary transition-colors"
        >
          <option value="pending">{MODERATION_COPY.queue.filterPending}</option>
          <option value="all">{MODERATION_COPY.queue.filterAll}</option>
          <option value="OPEN">{MODERATION_COPY.statuses.OPEN}</option>
          <option value="IN_REVIEW">{MODERATION_COPY.statuses.IN_REVIEW}</option>
          <option value="RESOLVED">{MODERATION_COPY.statuses.RESOLVED}</option>
          <option value="DISMISSED">{MODERATION_COPY.statuses.DISMISSED}</option>
        </select>
      </div>

      {isLoading ? (
        <div aria-busy="true" className="py-space-xl text-center text-body-md text-secondary" />
      ) : isError && items.length === 0 ? (
        <ErrorState
          title={messageFor(isApiError(error) ? error : { code: 'UNKNOWN' }).title}
          action={MODERATION_COPY.detail.retry}
          onRetry={() => void refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={MODERATION_COPY.queue.empty}
          description={MODERATION_COPY.queue.emptyDescription}
        />
      ) : (
        <div className="flex flex-col gap-space-sm">
          {items.map((item) => {
            const isSelected = item.reportId === selectedReportId;
            const isOverdue = slaState(item, Date.now()).kind === 'overdue';
            return (
              <Link
                key={item.reportId}
                to="/moderation/reports/$reportId"
                params={{ reportId: item.reportId }}
                className={`p-space-md rounded-lg border transition-colors flex flex-col gap-space-xs ${
                  isOverdue
                    ? 'border-error'
                    : isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-surface-container-high bg-surface-container-lowest hover:border-outline'
                }`}
              >
                <div className="flex items-center justify-between gap-space-xs flex-wrap">
                  <span className="font-semibold text-body-md text-on-surface">
                    {MODERATION_COPY.categories[item.category]}
                  </span>
                  <div className="flex items-center gap-space-xs">
                    {item.urgent ? <Badge tone="danger">{MODERATION_COPY.queue.urgentBadge}</Badge> : null}
                    <Badge tone={SEVERITY_BADGE_TONE[item.severity]}>
                      {MODERATION_COPY.severities[item.severity]}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-space-xs text-body-sm text-secondary">
                  <div className="flex items-center gap-space-xs">
                    <Badge tone={STATUS_BADGE_TONE[item.status]}>
                      {MODERATION_COPY.statuses[item.status]}
                    </Badge>
                    <SlaBadge report={item} />
                  </div>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
              </Link>
            );
          })}

          {hasNextPage ? (
            <Button
              variant="ghost"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
              className="mt-space-xs"
            >
              {MODERATION_COPY.queue.loadMore}
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  );
}
