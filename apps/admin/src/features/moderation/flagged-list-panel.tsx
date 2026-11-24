import { useMemo } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Badge, Button, Card, EmptyState, ErrorState } from '@tamgiao/ui-web';
import { MODERATION_COPY, formatFlagReason } from './copy';
import { formatDateTime } from '../kyc/format';
import { flaggedInfiniteQueryOptions } from './moderation-api';

export function FlaggedListPanel() {
  const client = useApiClient();
  const rawParams = useParams({ strict: false });
  const selectedMessageId = 'messageId' in rawParams ? rawParams.messageId : undefined;

  const { data, isLoading, isError, error, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery(flaggedInfiniteQueryOptions(client));

  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  return (
    <Card className="flex flex-col gap-space-md">
      <h2 className="text-title-md font-bold text-on-surface">{MODERATION_COPY.flagged.title}</h2>

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
          title={MODERATION_COPY.flagged.empty}
          description={MODERATION_COPY.flagged.emptyDescription}
        />
      ) : (
        <div className="flex flex-col gap-space-sm">
          {items.map((item) => {
            const isSelected = item.messageId === selectedMessageId;
            const shortSender = item.senderId.slice(0, 8);
            return (
              <Link
                key={item.messageId}
                to="/moderation/flagged/$messageId"
                params={{ messageId: item.messageId }}
                className={`p-space-md rounded-lg border transition-colors flex flex-col gap-space-xs ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-surface-container-high bg-surface-container-lowest hover:border-outline'
                }`}
              >
                <div className="flex items-center justify-between gap-space-xs flex-wrap">
                  <span className="text-body-sm font-medium text-secondary">
                    {MODERATION_COPY.flagged.sender}:{' '}
                    <span className="font-mono text-on-surface">{shortSender}…</span>
                  </span>
                  <span className="text-body-sm text-secondary">{formatDateTime(item.sentAt)}</span>
                </div>

                <div className="flex flex-wrap gap-space-xs mt-space-xs">
                  {item.reasons.map((reason) => (
                    <Badge key={reason} tone="warning">
                      {formatFlagReason(reason)}
                    </Badge>
                  ))}
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
              {MODERATION_COPY.flagged.loadMore}
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  );
}
