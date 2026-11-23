import { useId, useMemo, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import type { KycAdminStatus } from '@tamgiao/contracts/verification';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useParams, useRouteContext } from '@tanstack/react-router';
import { Badge, Button, Card, EmptyState, ErrorState, TextField, type BadgeTone } from '@tamgiao/ui-web';
import { KYC_COPY } from './copy';
import { formatDateTime } from './format';
import { DEFAULT_KYC_QUEUE_FILTERS, kycQueueQueryOptions, type KycQueueFilters } from './kyc-api';

const STATUS_BADGE_TONE = {
  SUBMITTED: 'primary',
  UNDER_REVIEW: 'neutral',
  NEEDS_MORE_INFO: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
} as const satisfies Record<KycAdminStatus, BadgeTone>;

export function KycQueuePanel() {
  const client = useApiClient();
  const me = useRouteContext({ from: '/_authed', select: (c) => c.me });
  const rawParams = useParams({ strict: false });
  const selectedSubmissionId = 'submissionId' in rawParams ? rawParams.submissionId : undefined;

  const [presetId, setPresetId] = useState('pending');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');

  const statusFilterId = useId();
  const flaggedCheckboxId = useId();

  const statuses: readonly KycAdminStatus[] =
    KYC_COPY.statusPresets.find((p) => p.id === presetId)?.statuses ?? DEFAULT_KYC_QUEUE_FILTERS.statuses;

  const filters: KycQueueFilters = useMemo(
    () => ({
      statuses,
      flagged: flaggedOnly ? true : null,
      q: appliedQuery,
    }),
    [statuses, flaggedOnly, appliedQuery],
  );

  const { data, isLoading, isError, error, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery(kycQueueQueryOptions(client, filters));

  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  return (
    <Card className="flex flex-col gap-space-md">
      <h2 className="text-title-md font-bold text-on-surface">{KYC_COPY.queue.label}</h2>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedQuery(searchInput.trim());
        }}
        className="flex items-end gap-space-xs"
      >
        <div className="flex-1">
          <TextField
            label={KYC_COPY.queue.searchLabel}
            placeholder={KYC_COPY.queue.searchPlaceholder}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Button type="submit" variant="primary">
          {KYC_COPY.queue.searchSubmit}
        </Button>
      </form>

      <div className="flex flex-col gap-space-xs">
        <label htmlFor={statusFilterId} className="text-label-md font-medium text-on-surface">
          {KYC_COPY.queue.statusFilterLabel}
        </label>
        <select
          id={statusFilterId}
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          className="min-h-[44px] px-space-md rounded-md bg-surface-container-lowest text-on-surface text-body-md border border-outline-variant focus:border-primary transition-colors"
        >
          {KYC_COPY.statusPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      <label
        htmlFor={flaggedCheckboxId}
        className="inline-flex items-center gap-space-xs text-body-md text-on-surface cursor-pointer select-none"
      >
        <input
          id={flaggedCheckboxId}
          type="checkbox"
          checked={flaggedOnly}
          onChange={(e) => setFlaggedOnly(e.target.checked)}
          className="h-4 w-4 accent-primary rounded cursor-pointer"
        />
        <span>{KYC_COPY.queue.flaggedOnly}</span>
      </label>

      {isLoading ? (
        <div aria-busy="true" className="p-space-lg flex justify-center text-body-sm text-secondary" />
      ) : isError && items.length === 0 ? (
        <ErrorState
          title={messageFor(isApiError(error) ? error : { code: 'UNKNOWN' }).title}
          onRetry={() => void refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title={KYC_COPY.queue.empty} description={KYC_COPY.queue.emptyDescription} />
      ) : (
        <div className="flex flex-col gap-space-sm">
          <ul aria-label={KYC_COPY.queue.label} className="flex flex-col gap-space-xs">
            {items.map((item) => {
              const isSelected = item.id === selectedSubmissionId;
              const reviewerText =
                item.reviewerId === me.adminId
                  ? KYC_COPY.queue.assignedToMe
                  : item.reviewerId !== null
                    ? KYC_COPY.queue.assignedToOther
                    : KYC_COPY.queue.unassigned;

              return (
                <li key={item.id}>
                  <Link
                    to="/kyc/$submissionId"
                    params={{ submissionId: item.id }}
                    aria-current={isSelected ? 'page' : undefined}
                    className={`block p-space-sm rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-primary-fixed border-primary text-on-primary-fixed'
                        : 'bg-surface-container-lowest border-surface-container-high hover:bg-surface-container-low text-on-surface'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-space-xs">
                      <span className="text-title-md font-semibold">
                        {item.fullName ?? KYC_COPY.queue.noName}
                      </span>
                      <Badge tone={STATUS_BADGE_TONE[item.status]}>{KYC_COPY.status[item.status]}</Badge>
                    </div>
                    {item.occupation ? (
                      <p className="text-body-sm text-secondary mt-0.5">{item.occupation}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-space-xs mt-space-xs">
                      {item.flags.length > 0 ? (
                        <Badge tone="danger">{KYC_COPY.queue.flagCount(item.flags.length)}</Badge>
                      ) : null}
                      <span className="text-body-sm text-secondary">
                        {KYC_COPY.queue.submittedAt} {formatDateTime(item.submittedAt)}
                      </span>
                    </div>
                    <p className="text-body-sm text-secondary mt-space-xs">{reviewerText}</p>
                  </Link>
                </li>
              );
            })}
          </ul>

          {hasNextPage ? (
            <div className="pt-space-xs">
              <Button
                variant="secondary"
                fullWidth
                loading={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {KYC_COPY.queue.loadMore}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
