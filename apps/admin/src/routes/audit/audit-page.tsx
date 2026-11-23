import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useApiClient } from '@tamgiao/api-client/react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { Button, EmptyState, ErrorState } from '@tamgiao/ui-web';
import { NAV_COPY } from '../../layout/copy';
import { auditLogsInfiniteQueryOptions } from './audit-api';
import { auditFieldErrors } from './audit-field-errors';
import { AuditFilterForm } from './audit-filter-form';
import { AuditLogTable } from './audit-log-table';
import { AUDIT_COPY } from './copy';

const routeApi = getRouteApi('/_authed/audit');

export function AuditPage() {
  const search = routeApi.useSearch();
  const navigate = useNavigate({ from: '/audit' });
  const client = useApiClient();

  const query = useInfiniteQuery({
    ...auditLogsInfiniteQueryOptions(client, search),
    throwOnError: (error) => isApiError(error) && error.status === 403,
  });

  const fieldErrors = auditFieldErrors(query.error);

  function renderContent() {
    if (query.isPending) {
      return (
        <div role="status" aria-busy="true" className="p-space-lg text-center text-body-md text-secondary">
          {AUDIT_COPY.loading}
        </div>
      );
    }

    if (query.isError && !query.data) {
      const errorInfo = messageFor(isApiError(query.error) ? query.error : { code: 'UNKNOWN' });
      if (isApiError(query.error) && query.error.code === 'VALIDATION_FAILED') {
        const hasMapped = Object.keys(fieldErrors).length > 0;
        return hasMapped ? (
          <ErrorState title={errorInfo.title} />
        ) : (
          <ErrorState
            title={errorInfo.title}
            action={AUDIT_COPY.reset}
            onRetry={() => {
              void navigate({ search: {} });
            }}
          />
        );
      }
      return (
        <ErrorState
          title={errorInfo.title}
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    }

    const items = query.data?.pages.flatMap((p) => p.items) ?? [];
    if (items.length === 0) {
      return <EmptyState title={AUDIT_COPY.emptyTitle} description={AUDIT_COPY.emptyDescription} />;
    }

    return (
      <div className="flex flex-col gap-space-md">
        <AuditLogTable items={items} />
        <div className="flex flex-col items-center gap-space-sm pt-space-xs pb-space-lg">
          {query.hasNextPage ? (
            <Button
              variant="secondary"
              loading={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              {AUDIT_COPY.loadMore}
            </Button>
          ) : (
            <p className="text-body-sm text-secondary">{AUDIT_COPY.endOfList}</p>
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
    <div className="flex flex-col gap-space-lg">
      <div className="flex flex-col gap-space-xs">
        <h1 className="text-headline-md font-bold text-on-surface">{NAV_COPY.audit}</h1>
        <p className="text-body-md text-secondary">{AUDIT_COPY.description}</p>
      </div>

      <AuditFilterForm
        key={JSON.stringify(search)}
        search={search}
        fieldErrors={fieldErrors}
        onApply={(nextSearch) => {
          void navigate({ search: nextSearch });
        }}
        onReset={() => {
          void navigate({ search: {} });
        }}
      />

      {renderContent()}
    </div>
  );
}
