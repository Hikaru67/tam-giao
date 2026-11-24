import { useCallback, useEffect, useRef } from 'react';
import { useApiClient } from '@tamgiao/api-client/react';
import { conversationListResponseSchema, type ConversationListResponse } from '@tamgiao/contracts/messaging';
import type { NotificationKindName } from '@tamgiao/contracts/notification';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useChatClient } from '../chat/chat-client-context.js';
import { CONVERSATIONS_QUERY_KEY } from '../match/index.js';
import { useForegroundNotification } from '../notifications/use-foreground-notification.js';

export const INBOX_PUSH_KINDS = [
  'MESSAGE_RECEIVED',
  'MATCH_STARTED_DATING',
] as const satisfies readonly NotificationKindName[];

export const INBOX_DEBOUNCE_MS = 500;

export function useInbox(): UseQueryResult<ConversationListResponse, Error> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const chatClient = useChatClient();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerDebouncedInvalidate = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
    }, INBOX_DEBOUNCE_MS);
  }, [queryClient]);

  useForegroundNotification(INBOX_PUSH_KINDS, () => {
    triggerDebouncedInvalidate();
  });

  useEffect(() => {
    const unsubscribe = chatClient.subscribe((event) => {
      if (event.type === 'message') {
        triggerDebouncedInvalidate();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [chatClient, triggerDebouncedInvalidate]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  return useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: () => client.get('/me/conversations', { schema: conversationListResponseSchema }),
  });
}
