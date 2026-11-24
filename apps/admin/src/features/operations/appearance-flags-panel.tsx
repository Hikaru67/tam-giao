import { useMemo } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Card, EmptyState, ErrorState } from '@tamgiao/ui-web';
import { formatDateTime } from '../kyc/format';
import type { AppearanceFlagQueueResponse } from '@tamgiao/contracts/dating';
import { APPEARANCE_FLAGS_COPY } from './copy';
import { appearanceFlagsInfiniteQueryOptions } from './operations-api';

type AppearanceFlagItem = AppearanceFlagQueueResponse['items'][number];

export function AppearanceFlagsPanel() {
  const client = useApiClient();
  const { feedbackId: currentFeedbackId } = useParams({ strict: false });

  const { data, isLoading, isError, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery(appearanceFlagsInfiniteQueryOptions(client));

  // Khử trùng theo feedbackId khi nối các trang
  const items = useMemo(() => {
    if (!data?.pages) return [];
    const seen = new Set<string>();
    const result: AppearanceFlagItem[] = [];
    for (const page of data.pages) {
      for (const item of page.items) {
        if (!seen.has(item.feedbackId)) {
          seen.add(item.feedbackId);
          result.push(item);
        }
      }
    }
    return result;
  }, [data]);

  if (isError && !data) {
    return (
      <Card>
        <ErrorState
          title={messageFor(isApiError(error) ? error : { code: 'UNKNOWN' }).title}
          onRetry={() => void refetch()}
        />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-space-md">
      <div className="flex items-center justify-between border-b border-surface-container-high pb-space-sm">
        <h2 className="text-title-md font-bold text-on-surface">{APPEARANCE_FLAGS_COPY.listTitle}</h2>
        {data?.pages[0]?.total !== undefined ? (
          <span className="text-label-sm text-secondary">{data.pages[0].total}</span>
        ) : null}
      </div>

      {isLoading && items.length === 0 ? (
        <div className="flex justify-center py-space-xl">
          <span
            className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
            aria-hidden="true"
          />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={APPEARANCE_FLAGS_COPY.empty}
          description={APPEARANCE_FLAGS_COPY.emptyDescription}
        />
      ) : (
        <div className="flex flex-col gap-space-sm">
          {items.map((item) => {
            const isSelected = item.feedbackId === currentFeedbackId;
            return (
              <Link
                key={item.feedbackId}
                to="/operations/appearance-flags/$feedbackId"
                params={{ feedbackId: item.feedbackId }}
                className={`p-space-md rounded-lg border transition-all text-left block ${
                  isSelected
                    ? 'border-primary bg-primary-fixed/20 shadow-sm'
                    : 'border-surface-container-high bg-surface-container-lowest hover:bg-surface-container-low'
                }`}
              >
                <div className="flex flex-col gap-space-xs">
                  <div className="flex items-center justify-between text-body-sm text-secondary">
                    <span>{APPEARANCE_FLAGS_COPY.submittedAt}</span>
                    <span>{formatDateTime(item.submittedAt)}</span>
                  </div>

                  <div className="text-body-sm text-on-surface">
                    <span className="text-secondary mr-1">{APPEARANCE_FLAGS_COPY.flagId}:</span>
                    <span className="font-mono text-secondary">{item.feedbackId}</span>
                  </div>

                  <div className="text-body-sm text-on-surface">
                    <span className="text-secondary mr-1">{APPEARANCE_FLAGS_COPY.subjectId}:</span>
                    <span className="font-mono font-medium">{item.subjectId}</span>
                  </div>

                  <div className="text-body-sm text-on-surface">
                    <span className="text-secondary mr-1">{APPEARANCE_FLAGS_COPY.authorId}:</span>
                    <span className="font-mono text-secondary">{item.authorId}</span>
                  </div>
                </div>
              </Link>
            );
          })}

          {hasNextPage ? (
            <div className="pt-space-sm">
              <Button
                variant="secondary"
                fullWidth
                loading={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {APPEARANCE_FLAGS_COPY.loadMore}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
