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
import { conversationListResponseSchema } from '@tamgiao/contracts/messaging';
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
export const CONVERSATIONS_QUERY_KEY = ['conversations'] as const;

export const WAITING_POLL_INTERVAL_MS = 15_000;
/** Hội thoại được mở bất đồng bộ sau khi vào DATING: hỏi nhanh lúc đầu, quá số lần này thì hỏi thưa. */
export const CONVERSATION_POLL_INTERVAL_MS = 2_000;
export const CONVERSATION_FAST_POLL_LIMIT = 15;
export const CONVERSATION_SLOW_POLL_INTERVAL_MS = 30_000;

export function useCurrentMatch(): UseQueryResult<CurrentMatchResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: CURRENT_MATCH_QUERY_KEY,
    queryFn: () => client.get('/me/match', { schema: currentMatchResponseSchema }),
    refetchInterval: (query) =>
      query.state.data?.match?.phase === 'WAITING_FOR_COUNTERPART' ? WAITING_POLL_INTERVAL_MS : false,
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

export function useWithdrawMatch(): UseMutationResult<MatchResponseResult, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<MatchResponseResult, Error, void>({
    mutationFn: () => client.post('/me/match/withdraw', { schema: matchResponseResultSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CURRENT_MATCH_QUERY_KEY }),
  });
}

export function useOpenConversationId(peerUserId: string | null): string | null {
  const client = useApiClient();
  const query = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: () => client.get('/me/conversations', { schema: conversationListResponseSchema }),
    enabled: peerUserId !== null,
    refetchInterval: (q) => {
      if (peerUserId === null) return false;
      const items = q.state.data?.items;
      const hasMatched = items?.some((c) => c.status === 'OPEN' && c.peerUserId === peerUserId);
      if (hasMatched) return false;
      return q.state.dataUpdateCount + q.state.errorUpdateCount < CONVERSATION_FAST_POLL_LIMIT
        ? CONVERSATION_POLL_INTERVAL_MS
        : CONVERSATION_SLOW_POLL_INTERVAL_MS;
    },
  });

  if (peerUserId === null || !query.data) {
    return null;
  }
  const matched = query.data.items.find((c) => c.status === 'OPEN' && c.peerUserId === peerUserId);
  return matched ? matched.conversationId : null;
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
