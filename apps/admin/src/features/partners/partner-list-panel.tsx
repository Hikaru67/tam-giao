import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorState } from '@tamgiao/ui-web';
import { PARTNERS_COPY } from './copy';
import { PartnerFormDialog } from './partner-form-dialog';
import { partnersListQueryOptions } from './partners-api';

type FilterType = 'all' | 'active' | 'inactive';

export function PartnerListPanel() {
  const client = useApiClient();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const currentPartnerId = 'partnerId' in params ? params.partnerId : undefined;

  const [filter, setFilter] = useState<FilterType>('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const activeQuery = filter === 'active' ? true : filter === 'inactive' ? false : undefined;
  const listQuery = useQuery(partnersListQueryOptions(client, activeQuery));

  const items = listQuery.data?.items ?? [];

  return (
    <Card className="flex flex-col gap-space-md p-space-md">
      <div className="flex items-center justify-between gap-space-sm flex-wrap">
        <h2 className="text-title-md font-semibold text-on-surface">{PARTNERS_COPY.list.title}</h2>
        <Button variant="primary" size="md" onClick={() => setCreateDialogOpen(true)}>
          {PARTNERS_COPY.list.createButton}
        </Button>
      </div>

      <div className="flex flex-col gap-space-xs">
        <label htmlFor="partner-status-filter" className="text-label-sm font-medium text-secondary">
          {PARTNERS_COPY.filters.filterLabel}
        </label>
        <select
          id="partner-status-filter"
          aria-label={PARTNERS_COPY.filters.filterLabel}
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterType)}
          className="min-h-[40px] px-space-md py-space-xs rounded-md bg-surface-container-lowest text-on-surface text-body-md border border-outline-variant outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">{PARTNERS_COPY.filters.all}</option>
          <option value="active">{PARTNERS_COPY.filters.active}</option>
          <option value="inactive">{PARTNERS_COPY.filters.inactive}</option>
        </select>
      </div>

      {listQuery.isLoading && items.length === 0 ? (
        <div aria-busy="true" className="text-body-sm text-secondary py-space-md text-center" />
      ) : listQuery.isError && listQuery.data === undefined ? (
        <ErrorState
          title={messageFor(isApiError(listQuery.error) ? listQuery.error : { code: 'UNKNOWN' }).title}
          onRetry={() => void listQuery.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title={PARTNERS_COPY.list.empty} description={PARTNERS_COPY.list.emptyDescription} />
      ) : (
        <div className="flex flex-col gap-space-xs overflow-y-auto max-h-[70vh]">
          {items.map((partner) => {
            const isSelected = partner.id === currentPartnerId;
            return (
              <Link
                key={partner.id}
                to="/partners/$partnerId"
                params={{ partnerId: partner.id }}
                className={`p-space-sm rounded-lg border transition-colors flex flex-col gap-space-xs ${
                  isSelected
                    ? 'border-primary bg-primary-fixed/20'
                    : 'border-surface-container-high hover:border-outline bg-surface-container-lowest'
                }`}
              >
                <div className="flex items-center justify-between gap-space-xs flex-wrap">
                  <span className="font-semibold text-body-md text-on-surface">{partner.name}</span>
                  <Badge tone={partner.active ? 'success' : 'neutral'}>
                    {partner.active ? PARTNERS_COPY.list.activeBadge : PARTNERS_COPY.list.inactiveBadge}
                  </Badge>
                </div>
                <p className="text-body-sm text-secondary truncate">{partner.address}</p>
                {partner.tags.length > 0 ? (
                  <span className="text-body-sm text-secondary">
                    {PARTNERS_COPY.list.tagsCount(partner.tags.length)}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}

      <PartnerFormDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSuccess={(saved) => {
          void navigate({ to: '/partners/$partnerId', params: { partnerId: saved.id } });
        }}
      />
    </Card>
  );
}
