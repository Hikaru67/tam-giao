import { useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useApiClient } from '@tamgiao/api-client/react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useRouteContext } from '@tanstack/react-router';
import { Button, Card, ErrorState, TextField } from '@tamgiao/ui-web';
import { hasPermission } from '../auth/permissions';
import { kycQueueQueryOptions } from '../kyc/kyc-api';
import { MATCHING_COPY } from './copy';
import { isUuid, normalizeUserId } from './user-id';

export interface SelectedUser {
  readonly userId: string;
  readonly fullName: string | null;
  readonly occupation: string | null;
}

export interface ApprovedUserPickerProps {
  readonly onSelect: (user: SelectedUser) => void;
}

export function ApprovedUserPicker({ onSelect }: ApprovedUserPickerProps) {
  const client = useApiClient();

  // Danh sách hồ sơ đã duyệt chỉ có ở API eKYC (`kyc:review`); vai trò không có quyền này nhập mã người dùng.
  const me = useRouteContext({ from: '/_authed', select: (c) => c.me });
  const canReviewKyc = hasPermission(me, 'kyc:review');

  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [manualIdInput, setManualIdInput] = useState('');
  const [manualIdError, setManualIdError] = useState<string | null>(null);

  const approvedQuery = useInfiniteQuery({
    ...kycQueueQueryOptions(client, {
      statuses: ['APPROVED'],
      flagged: null,
      q: searchTerm,
    }),
    enabled: canReviewKyc,
  });

  const approvedItems = approvedQuery.data?.pages.flatMap((page) => page.items) ?? [];

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setSearchTerm(searchInput.trim());
  }

  function handleManualIdSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = normalizeUserId(manualIdInput);
    if (!isUuid(trimmed)) {
      setManualIdError(MATCHING_COPY.propose.invalidUuid);
      return;
    }
    setManualIdError(null);
    onSelect({ userId: trimmed, fullName: null, occupation: null });
  }

  return (
    <div className="flex flex-col gap-space-lg">
      {canReviewKyc ? (
        <Card className="flex flex-col gap-space-md">
          <h3 className="text-title-md font-bold text-on-surface">{MATCHING_COPY.propose.userPickerTitle}</h3>

          <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-space-sm items-end">
            <TextField
              label={MATCHING_COPY.propose.searchLabel}
              placeholder={MATCHING_COPY.propose.searchPlaceholder}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Button type="submit" variant="secondary" className="shrink-0">
              {MATCHING_COPY.propose.searchSubmit}
            </Button>
          </form>

          {approvedQuery.isPending ? (
            <p className="text-body-sm text-secondary py-space-sm">
              {MATCHING_COPY.propose.approvedUsersLoading}
            </p>
          ) : approvedQuery.isError && approvedItems.length === 0 ? (
            <ErrorState
              title={
                messageFor(isApiError(approvedQuery.error) ? approvedQuery.error : { code: 'UNKNOWN' }).title
              }
              onRetry={() => void approvedQuery.refetch()}
            />
          ) : approvedItems.length === 0 ? (
            <p className="text-body-sm text-secondary py-space-sm">{MATCHING_COPY.propose.noApprovedUsers}</p>
          ) : (
            <div className="flex flex-col gap-space-xs max-h-60 overflow-y-auto pr-space-xs divide-y divide-surface-container-high">
              {approvedItems.map((item) => {
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-space-sm rounded-lg transition-colors hover:bg-surface-container-low"
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold text-body-md text-on-surface">
                        {item.fullName ? item.fullName : MATCHING_COPY.unknownName}
                      </span>
                      <span className="text-body-sm text-secondary">
                        {item.occupation ? `${item.occupation} • ` : ''}
                        {item.userId.slice(0, 8)}
                      </span>
                    </div>
                    <Button
                      size="md"
                      variant="secondary"
                      onClick={() =>
                        onSelect({
                          userId: item.userId,
                          fullName: item.fullName,
                          occupation: item.occupation,
                        })
                      }
                    >
                      {MATCHING_COPY.propose.selectButton}
                    </Button>
                  </div>
                );
              })}

              {approvedQuery.hasNextPage ? (
                <div className="pt-space-xs flex justify-center">
                  <Button
                    variant="ghost"
                    size="md"
                    loading={approvedQuery.isFetchingNextPage}
                    onClick={() => {
                      void approvedQuery.fetchNextPage();
                    }}
                  >
                    {MATCHING_COPY.propose.loadMoreUsers}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      ) : null}

      <Card className="flex flex-col gap-space-md">
        <h3 className="text-title-md font-bold text-on-surface">{MATCHING_COPY.propose.manualInputTitle}</h3>
        <form onSubmit={handleManualIdSubmit} className="flex flex-col sm:flex-row gap-space-sm items-end">
          <TextField
            label={MATCHING_COPY.propose.manualInputLabel}
            placeholder={MATCHING_COPY.propose.manualInputPlaceholder}
            value={manualIdInput}
            onChange={(e) => {
              setManualIdInput(e.target.value);
              if (manualIdError) setManualIdError(null);
            }}
            {...(manualIdError ? { error: manualIdError } : {})}
          />
          <Button type="submit" variant="secondary" className="shrink-0">
            {MATCHING_COPY.propose.manualInputSubmit}
          </Button>
        </form>
      </Card>
    </div>
  );
}
