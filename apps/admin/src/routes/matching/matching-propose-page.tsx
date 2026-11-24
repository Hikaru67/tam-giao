import { useEffect, useState } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApiClient } from '@tamgiao/api-client/react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { PAGE_LIMIT_MAX } from '@tamgiao/contracts/http';
import { OPEN_MATCH_STATUS_NAMES, type AdminCandidateDto } from '@tamgiao/contracts/matching';
import { Button, Card, EmptyState, ErrorState, useToast } from '@tamgiao/ui-web';
import { ApprovedUserPicker, type SelectedUser } from '../../features/matching/approved-user-picker';
import { CandidateList } from '../../features/matching/candidate-list';
import { MATCHING_COPY } from '../../features/matching/copy';
import { ineligibilityFromError } from '../../features/matching/ineligibility';
import {
  busyUserIds,
  candidatesQueryOptions,
  matchesBoardInfiniteQueryOptions,
  useProposeMatch,
} from '../../features/matching/matching-api';
import { ProfileComparison } from '../../features/matching/profile-comparison';
import { ProposeForm } from '../../features/matching/propose-form';

const routeApi = getRouteApi('/_authed/matching/propose');

export function MatchingProposePage() {
  const search = routeApi.useSearch();
  const navigate = useNavigate({ from: '/matching/propose' });
  const client = useApiClient();
  const { showToast } = useToast();

  const [selectedUserA, setSelectedUserA] = useState<SelectedUser | null>(() =>
    search.userId ? { userId: search.userId, fullName: null, occupation: null } : null,
  );
  const [selectedCandidate, setSelectedCandidate] = useState<AdminCandidateDto | null>(null);
  const [ineligibleMap, setIneligibleMap] = useState<Map<string, string>>(new Map());
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  const activeUserA =
    selectedUserA?.userId === search.userId
      ? selectedUserA
      : search.userId
        ? { userId: search.userId, fullName: null, occupation: null }
        : null;

  // Tải hết các cặp đang mở để biết ai đang bận (API ứng viên đã loại người bận nhưng trạng thái có thể đổi sau đó).
  const boardQuery = useInfiniteQuery(
    matchesBoardInfiniteQueryOptions(client, OPEN_MATCH_STATUS_NAMES, PAGE_LIMIT_MAX),
  );
  const { hasNextPage, isFetching, isError: boardFailed, fetchNextPage } = boardQuery;
  useEffect(() => {
    if (hasNextPage && !isFetching && !boardFailed) void fetchNextPage();
  }, [hasNextPage, isFetching, boardFailed, fetchNextPage]);
  const boardItems = boardQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const busySet = busyUserIds(boardItems);

  const userABlockedReason =
    activeUserA === null
      ? null
      : busySet.has(activeUserA.userId)
        ? MATCHING_COPY.ineligibleReasons.USER_BUSY
        : (ineligibleMap.get(activeUserA.userId) ?? null);

  const candidatesQuery = useQuery({
    ...candidatesQueryOptions(client, activeUserA?.userId ?? ''),
    enabled: Boolean(activeUserA?.userId),
  });

  const proposeMutation = useProposeMatch();

  const computedIneligible = new Map<string, string>(ineligibleMap);
  for (const candidate of candidatesQuery.data?.items ?? []) {
    if (busySet.has(candidate.userId)) {
      computedIneligible.set(candidate.userId, MATCHING_COPY.ineligibleReasons.USER_BUSY);
    }
  }

  // Ứng viên đang chọn có thể vừa bận (bảng cặp làm mới) → coi như chưa chọn.
  const activeCandidate =
    selectedCandidate !== null && !computedIneligible.has(selectedCandidate.userId)
      ? selectedCandidate
      : null;

  function handleSelectUser(user: SelectedUser) {
    setSelectedUserA(user);
    setSelectedCandidate(null);
    setIneligibleMap(new Map());
    setAlertMessage(null);
    void navigate({ search: { userId: user.userId } });
  }

  function handleResetUser() {
    setSelectedUserA(null);
    setSelectedCandidate(null);
    setIneligibleMap(new Map());
    setAlertMessage(null);
    void navigate({ search: {} });
  }

  function handleSubmitPropose(data: { userAId: string; userBId: string; staffNote: string | null }) {
    setAlertMessage(null);
    proposeMutation.mutate(data, {
      onSuccess: () => {
        showToast(MATCHING_COPY.propose.successToast, 'success');
        void navigate({ to: '/matching' });
      },
      onError: (error) => {
        const ineligibility = ineligibilityFromError(error, {
          userAId: data.userAId,
          userBId: data.userBId,
        });

        if (ineligibility) {
          const reasonText = MATCHING_COPY.ineligibleReasons[ineligibility.code];
          setIneligibleMap((prev) => {
            const next = new Map(prev);
            for (const id of ineligibility.userIds) next.set(id, reasonText);
            return next;
          });
          // Lý do hiện ngay tại ứng viên / banner người chính; không cần banner chung.
          if (ineligibility.userIds.includes(data.userBId)) setSelectedCandidate(null);
        } else {
          setAlertMessage(messageFor(isApiError(error) ? error : { code: 'UNKNOWN' }).title);
        }
      },
    });
  }

  function renderCandidatesContent() {
    if (!activeUserA) {
      return (
        <Card className="p-space-lg text-center text-body-md text-secondary">
          {MATCHING_COPY.propose.selectUserPrompt}
        </Card>
      );
    }

    if (candidatesQuery.isPending) {
      return (
        <div role="status" aria-busy="true" className="p-space-lg text-center text-body-md text-secondary">
          {MATCHING_COPY.propose.candidatesLoading}
        </div>
      );
    }

    if (candidatesQuery.isError) {
      const err = candidatesQuery.error;
      if (isApiError(err) && err.code === 'CANDIDATE_PROFILE_NOT_FOUND') {
        return (
          <EmptyState
            title={MATCHING_COPY.ineligibleReasons.CANDIDATE_PROFILE_NOT_FOUND}
            description={MATCHING_COPY.propose.noCandidatesProfileNotFound}
          />
        );
      }
      return (
        <ErrorState
          title={messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title}
          onRetry={() => {
            void candidatesQuery.refetch();
          }}
        />
      );
    }

    const candidateItems = candidatesQuery.data?.items ?? [];

    return (
      <CandidateList
        candidates={candidateItems}
        selectedCandidateId={activeCandidate?.userId ?? null}
        onSelectCandidate={(candidate) => setSelectedCandidate(candidate)}
        ineligible={computedIneligible}
        userABlocked={userABlockedReason !== null}
      />
    );
  }

  return (
    <div className="flex flex-col gap-space-lg pb-space-xl">
      {userABlockedReason !== null ? (
        <div
          role="alert"
          className="p-space-md rounded-xl bg-error-container text-on-error-container font-medium text-body-md"
        >
          {MATCHING_COPY.propose.userABlocked(userABlockedReason)}
        </div>
      ) : null}

      {alertMessage !== null && userABlockedReason === null ? (
        <div
          role="alert"
          className="p-space-md rounded-xl bg-error-container text-on-error-container font-medium text-body-md"
        >
          {alertMessage}
        </div>
      ) : null}

      <div className="flex flex-col gap-space-sm">
        <h2 className="text-headline-sm font-bold text-on-surface">
          {MATCHING_COPY.propose.selectUserASection}
        </h2>
        {activeUserA ? (
          <Card className="flex flex-col sm:flex-row sm:items-center justify-between p-space-md gap-space-sm bg-primary-container/5 border-primary">
            <div className="flex flex-col">
              <span className="text-label-sm uppercase tracking-wide text-primary font-bold">
                {MATCHING_COPY.propose.selectedUser}
              </span>
              <span className="text-title-md font-bold text-on-surface">
                {activeUserA.fullName ? activeUserA.fullName : MATCHING_COPY.unknownName}
              </span>
              <span className="text-body-sm text-secondary font-mono">{activeUserA.userId}</span>
            </div>
            <Button variant="secondary" size="md" onClick={handleResetUser}>
              {MATCHING_COPY.propose.changeUser}
            </Button>
          </Card>
        ) : (
          <ApprovedUserPicker onSelect={handleSelectUser} />
        )}
      </div>

      <div className="flex flex-col gap-space-sm">
        <h2 className="text-headline-sm font-bold text-on-surface">
          {MATCHING_COPY.propose.candidatesSection}
        </h2>
        {renderCandidatesContent()}
      </div>

      {activeUserA && activeCandidate ? (
        <>
          <ProfileComparison personA={activeUserA} personB={activeCandidate} />

          <ProposeForm
            key={`${activeUserA.userId}:${activeCandidate.userId}`}
            userAId={activeUserA.userId}
            userBId={activeCandidate.userId}
            disabled={userABlockedReason !== null}
            isSubmitting={proposeMutation.isPending}
            onSubmit={handleSubmitPropose}
          />
        </>
      ) : null}
    </div>
  );
}
