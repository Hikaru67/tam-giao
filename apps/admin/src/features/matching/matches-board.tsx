import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useApiClient } from '@tamgiao/api-client/react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import {
  MATCH_STATUS_NAMES,
  OPEN_MATCH_STATUS_NAMES,
  type MatchesBoardItem,
  type MatchStatusName,
} from '@tamgiao/contracts/matching';
import { PAGE_LIMIT_DEFAULT } from '@tamgiao/contracts/http';
import { Badge, Button, EmptyState, ErrorState, type BadgeTone } from '@tamgiao/ui-web';
import { formatDateTime } from '../kyc/format';
import { MATCHING_COPY } from './copy';
import { matchesBoardInfiniteQueryOptions } from './matching-api';

const STATUS_BADGE_TONES = {
  OFFERED: 'primary',
  AWAITING_RESPONSE: 'warning',
  DATING: 'success',
  MET: 'success',
  CLOSED_SUCCESS: 'neutral',
  CLOSED_STOPPED: 'neutral',
  EXPIRED: 'neutral',
  DECLINED: 'danger',
  LOCKED: 'danger',
} as const satisfies Record<MatchStatusName, BadgeTone>;

type StatusFilterValue = 'OPEN' | MatchStatusName;

export function MatchesBoard() {
  const client = useApiClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('OPEN');

  const selectedStatuses = statusFilter === 'OPEN' ? OPEN_MATCH_STATUS_NAMES : [statusFilter];

  const query = useInfiniteQuery(
    matchesBoardInfiniteQueryOptions(client, selectedStatuses, PAGE_LIMIT_DEFAULT),
  );

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  function renderTableContent() {
    if (query.isPending) {
      return (
        <div role="status" aria-busy="true" className="p-space-lg text-center text-body-md text-secondary">
          {MATCHING_COPY.board.loading}
        </div>
      );
    }

    if (query.isError && !query.data) {
      const errorInfo = messageFor(isApiError(query.error) ? query.error : { code: 'UNKNOWN' });
      return (
        <ErrorState
          title={errorInfo.title}
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    }

    if (items.length === 0) {
      return (
        <EmptyState title={MATCHING_COPY.board.empty} description={MATCHING_COPY.board.emptyDescription} />
      );
    }

    return (
      <div className="flex flex-col gap-space-md">
        <div className="overflow-x-auto rounded-xl border border-surface-container-high bg-surface-container-lowest">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-surface-container-high bg-surface-container-low text-label-md font-semibold text-secondary">
                <th className="p-space-md">{MATCHING_COPY.board.participants}</th>
                <th className="p-space-md">{MATCHING_COPY.board.status}</th>
                <th className="p-space-md">{MATCHING_COPY.board.expiresAt}</th>
                <th className="p-space-md">{MATCHING_COPY.board.offeredAt}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high text-body-md text-on-surface">
              {items.map((item: MatchesBoardItem) => (
                <tr key={item.matchId} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="p-space-md">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-space-xs">
                      {item.participants.map((p, idx) => (
                        <div key={p.userId} className="flex items-center gap-space-xs">
                          {idx > 0 ? (
                            <span className="text-secondary select-none font-bold mx-space-xs">↔</span>
                          ) : null}
                          <span className="font-medium">
                            {p.fullName ? p.fullName : MATCHING_COPY.unknownName}
                          </span>
                          <span className="text-body-sm text-secondary">({p.userId.slice(0, 8)})</span>
                          {p.accepted ? (
                            <Badge tone="success">{MATCHING_COPY.board.acceptedBadge}</Badge>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="p-space-md">
                    <Badge tone={STATUS_BADGE_TONES[item.status]}>{MATCHING_COPY.status[item.status]}</Badge>
                  </td>
                  <td className="p-space-md text-secondary">
                    {item.expiresAt ? formatDateTime(item.expiresAt) : MATCHING_COPY.unknownValue}
                  </td>
                  <td className="p-space-md text-secondary">{formatDateTime(item.offeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-center gap-space-sm pt-space-xs pb-space-lg">
          {query.hasNextPage ? (
            <Button
              variant="secondary"
              loading={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              {MATCHING_COPY.board.loadMore}
            </Button>
          ) : (
            <p className="text-body-sm text-secondary">{MATCHING_COPY.board.endOfList}</p>
          )}
          {query.isFetchNextPageError ? (
            <div role="alert" className="text-body-sm text-error">
              {messageFor(isApiError(query.error) ? query.error : { code: 'UNKNOWN' }).title}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-space-md">
      <div className="flex items-center gap-space-sm">
        <label htmlFor="status-filter-select" className="text-label-md font-medium text-on-surface">
          {MATCHING_COPY.statusFilter.label}
        </label>
        <select
          id="status-filter-select"
          aria-label={MATCHING_COPY.statusFilter.label}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilterValue)}
          className="min-h-[40px] px-space-md py-space-xs rounded-md bg-surface-container-lowest text-on-surface text-body-md border border-outline-variant hover:border-outline focus:border-primary outline-none"
        >
          <option value="OPEN">{MATCHING_COPY.statusFilter.openOption}</option>
          {MATCH_STATUS_NAMES.map((status) => (
            <option key={status} value={status}>
              {MATCHING_COPY.status[status]}
            </option>
          ))}
        </select>
      </div>

      {renderTableContent()}
    </div>
  );
}
