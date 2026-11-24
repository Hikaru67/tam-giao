import { useCallback } from 'react';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  currentMatchResponseSchema,
  matchProfileResponseSchema,
  matchResponseResultSchema,
  type CurrentMatchResponse,
  type MatchProfileResponse,
  type MatchResponseResult,
} from '@tamgiao/contracts/matching';
import type { NotificationKindName } from '@tamgiao/contracts/notification';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useForegroundNotification } from '../notifications/use-foreground-notification.js';

export const MATCH_QUERY_KEY = ['match'] as const;
export const CURRENT_MATCH_QUERY_KEY = ['match', 'current'] as const;
export const matchProfileQueryKey = (matchId: string) => ['match', 'profile', matchId] as const;

export function useCurrentMatch(): UseQueryResult<CurrentMatchResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: CURRENT_MATCH_QUERY_KEY,
    queryFn: () => client.get('/me/match', { schema: currentMatchResponseSchema }),
  });
}

export function useMatchProfile(matchId: string): UseQueryResult<MatchProfileResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: matchProfileQueryKey(matchId),
    queryFn: () =>
      client.get('/me/match/profile', {
        query: { matchId },
        schema: matchProfileResponseSchema,
      }),
  });
}

export function useAcceptMatch(): UseMutationResult<MatchResponseResult, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<MatchResponseResult, Error, void>({
    mutationFn: () => client.post('/me/match/accept', { schema: matchResponseResultSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CURRENT_MATCH_QUERY_KEY }),
  });
}

export function useDeclineMatch(): UseMutationResult<MatchResponseResult, Error, { reason: string | null }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<MatchResponseResult, Error, { reason: string | null }>({
    mutationFn: ({ reason }) =>
      client.post('/me/match/decline', {
        schema: matchResponseResultSchema,
        ...(reason !== null ? { body: { reason } } : {}),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CURRENT_MATCH_QUERY_KEY }),
  });
}

export const MATCH_PUSH_KINDS = [
  'MATCH_OFFERED',
  'MATCH_OFFER_EXPIRING',
  'MATCH_AWAITING_RESPONSE',
  'MATCH_STARTED_DATING',
] as const satisfies readonly NotificationKindName[];

export function useRefreshMatch(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: CURRENT_MATCH_QUERY_KEY });
  }, [queryClient]);
}

export function useMatchPushRefresh(): void {
  const refresh = useRefreshMatch();
  useForegroundNotification(MATCH_PUSH_KINDS, () => {
    void refresh();
  });
}
