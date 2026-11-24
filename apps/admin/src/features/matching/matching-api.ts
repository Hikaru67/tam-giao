import { isApiError, type ApiClient } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  adminCandidateListResponseSchema,
  matchesBoardResponseSchema,
  proposeMatchBodySchema,
  proposeMatchResponseSchema,
  OPEN_MATCH_STATUS_NAMES,
  type MatchesBoardItem,
  type MatchStatusName,
  type ProposeMatchBody,
} from '@tamgiao/contracts/matching';
import { infiniteQueryOptions, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

export const MATCHING_QUERY_KEYS = {
  all: ['admin', 'matching'] as const,
  board: ['admin', 'matching', 'board'] as const,
  boardList: (statuses: readonly MatchStatusName[], limit: number) =>
    ['admin', 'matching', 'board', statuses, limit] as const,
  candidates: (userId: string) => ['admin', 'matching', 'candidates', userId] as const,
};

/** Số ứng viên tối đa BE trả một lần (`adminCandidateListQuerySchema`). */
export const CANDIDATE_LIMIT = 50;

export function candidatesQueryOptions(client: ApiClient, userId: string) {
  return queryOptions({
    queryKey: MATCHING_QUERY_KEYS.candidates(userId),
    queryFn: ({ signal }) =>
      client.get(`/admin/users/${encodeURIComponent(userId)}/candidates`, {
        query: { limit: CANDIDATE_LIMIT },
        schema: adminCandidateListResponseSchema,
        signal,
      }),
    gcTime: 0,
    throwOnError: (error) => isApiError(error) && error.status === 403,
  });
}

export function matchesBoardInfiniteQueryOptions(
  client: ApiClient,
  statuses: readonly MatchStatusName[],
  limit: number,
) {
  return infiniteQueryOptions({
    queryKey: MATCHING_QUERY_KEYS.boardList(statuses, limit),
    queryFn: ({ pageParam, signal }) =>
      client.get('/admin/matches', {
        query: { status: statuses.join(','), limit, cursor: pageParam ?? undefined },
        schema: matchesBoardResponseSchema,
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    throwOnError: (error) => isApiError(error) && error.status === 403,
  });
}

export function busyUserIds(items: readonly MatchesBoardItem[]): ReadonlySet<string> {
  const set = new Set<string>();
  const openSet = new Set<string>(OPEN_MATCH_STATUS_NAMES);
  for (const item of items) {
    if (openSet.has(item.status)) {
      for (const p of item.participants) {
        set.add(p.userId);
      }
    }
  }
  return set;
}

export function useProposeMatch() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ProposeMatchBody) =>
      client.post('/admin/matches', {
        body: proposeMatchBodySchema.parse(body),
        schema: proposeMatchResponseSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MATCHING_QUERY_KEYS.all });
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: MATCHING_QUERY_KEYS.board });
    },
  });
}
