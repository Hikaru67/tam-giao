import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isApiError } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { mergeMessages } from '@tamgiao/api-client/ws';
import {
  conversationListResponseSchema,
  icebreakersResponseSchema,
  markConversationReadResponseSchema,
  messagesAfterResponseSchema,
  type ConversationListResponse,
  type ConversationMessageDto,
  type ConversationSummaryDto,
  type IcebreakersResponse,
} from '@tamgiao/contracts/messaging';
import { useInfiniteQuery, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { CONVERSATIONS_QUERY_KEY } from '../match/index.js';
import { useChatClient, usePendingMessages } from './chat-client-context.js';

/** Chặn vòng lặp lấy bù tin khi server luôn báo còn tin. */
const CATCH_UP_MAX_ROUNDS = 20;

export function useConversationSummary(conversationId: string) {
  const client = useApiClient();
  const query = useQuery<ConversationListResponse, Error, ConversationSummaryDto | null>({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: () => client.get('/me/conversations', { schema: conversationListResponseSchema }),
    select: (data) => data.items.find((item) => item.conversationId === conversationId) ?? null,
  });

  return {
    summary: query.data ?? null,
    // Cache hộp thư có thể cũ hơn hội thoại vừa mở: đang tải lại thì chưa kết luận là không có.
    isLoading: query.isLoading || (!query.data && query.isFetching),
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useConversationMessages(conversationId: string) {
  const chatClient = useChatClient();
  const apiClient = useApiClient();
  const { summary } = useConversationSummary(conversationId);
  const peerUserId = summary?.peerUserId ?? null;

  const [live, setLive] = useState<readonly ConversationMessageDto[]>([]);
  const [peerReadMessageId, setPeerReadMessageId] = useState<string | null>(null);
  const [closedByServer, setClosedByServer] = useState(false);
  const [forbiddenState, setForbiddenState] = useState(false);

  const pending = usePendingMessages(conversationId);

  const messagesQuery = useInfiniteQuery({
    queryKey: ['chat', conversationId, 'messages'] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await apiClient.get(`/me/conversations/${conversationId}/messages`, {
        ...(pageParam !== undefined ? { query: { before: pageParam } } : {}),
        schema: messagesAfterResponseSchema,
      });
      chatClient.confirm(res.items);
      return res;
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.items.length === 0) {
        return undefined;
      }
      return lastPage.items[0]?.messageId;
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const historyMessages = useMemo(() => {
    if (!messagesQuery.data?.pages) return [];
    let all: readonly ConversationMessageDto[] = [];
    for (const page of messagesQuery.data.pages) {
      all = mergeMessages(all, page.items);
    }
    return all;
  }, [messagesQuery.data?.pages]);

  const messages = useMemo(() => {
    return mergeMessages(historyMessages, live);
  }, [historyMessages, live]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /**
   * Lấy tin bị lỡ sau mỗi lần vào phòng (`after` = tin cuối đã có). Vào phòng trước khi trang đầu tải xong thì chờ trang
   * đầu: trang đó có thể được đọc trước lúc vào phòng nên vẫn phải lấy bù một lần.
   */
  const needsCatchUpRef = useRef(false);
  const { isSuccess: isHistoryReady, refetch: refetchHistory } = messagesQuery;
  const runCatchUp = () => {
    if (!isHistoryReady || !needsCatchUpRef.current) return;
    needsCatchUpRef.current = false;
    const last = messagesRef.current.at(-1);
    if (last === undefined) {
      void refetchHistory();
      return;
    }
    void (async () => {
      let cursor = last.messageId;
      try {
        for (let round = 0; round < CATCH_UP_MAX_ROUNDS; round++) {
          const res = await apiClient.get(`/me/conversations/${conversationId}/messages`, {
            query: { after: cursor },
            schema: messagesAfterResponseSchema,
          });
          chatClient.confirm(res.items);
          const newest = res.items.at(-1);
          if (newest === undefined) break;
          setLive((prev) => mergeMessages(prev, res.items));
          cursor = newest.messageId;
          if (!res.hasMore) break;
        }
      } catch {
        // Mất mạng giữa chừng: lần vào phòng sau lấy lại.
      }
    })();
  };
  const runCatchUpRef = useRef(runCatchUp);
  runCatchUpRef.current = runCatchUp;

  useEffect(() => {
    if (isHistoryReady) runCatchUpRef.current();
  }, [isHistoryReady]);

  useEffect(() => {
    chatClient.join(conversationId);
    return () => {
      chatClient.leave(conversationId);
    };
  }, [chatClient, conversationId]);

  useEffect(() => {
    const unsubscribe = chatClient.subscribe((event) => {
      if (event.type === 'message') {
        if (event.message.conversationId === conversationId) {
          setLive((prev) => mergeMessages(prev, [event.message]));
        }
      } else if (event.type === 'joined') {
        if (event.conversationId === conversationId) {
          if (event.status === 'CLOSED') {
            setClosedByServer(true);
          }
          needsCatchUpRef.current = true;
          runCatchUpRef.current();
        }
      } else if (event.type === 'read') {
        if (event.conversationId === conversationId && peerUserId !== null && event.readerId === peerUserId) {
          setPeerReadMessageId((prev) => {
            if (prev === null || event.messageId > prev) {
              return event.messageId;
            }
            return prev;
          });
        }
      } else if (event.type === 'conversation-error') {
        if (event.conversationId === conversationId) {
          if (event.code === 'CONVERSATION_CLOSED') {
            setClosedByServer(true);
          } else if (
            event.code === 'NOT_PARTICIPANT' ||
            event.code === 'NOT_FOUND' ||
            event.code === 'INVALID_ID'
          ) {
            setForbiddenState(true);
          }
        }
      }
    });

    return unsubscribe;
  }, [chatClient, conversationId, peerUserId]);

  const isQueryForbidden =
    isApiError(messagesQuery.error) &&
    (messagesQuery.error.code === 'NOT_PARTICIPANT' ||
      messagesQuery.error.code === 'NOT_FOUND' ||
      messagesQuery.error.code === 'INVALID_ID' ||
      messagesQuery.error.status === 403 ||
      messagesQuery.error.status === 404);

  const forbidden = forbiddenState || isQueryForbidden;

  const loadOlder = useCallback(() => {
    if (messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage) {
      void messagesQuery.fetchNextPage();
    }
  }, [messagesQuery]);

  return {
    messages,
    pending,
    isLoading: messagesQuery.isLoading,
    isError: messagesQuery.isError,
    error: messagesQuery.error,
    refetch: messagesQuery.refetch,
    hasOlder: !!messagesQuery.hasNextPage,
    loadOlder,
    isLoadingOlder: messagesQuery.isFetchingNextPage,
    peerReadMessageId,
    closedByServer,
    forbidden,
  };
}

export function useMarkRead(
  conversationId: string,
  messages: readonly ConversationMessageDto[],
  summary: ConversationSummaryDto | null,
) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const sendingRef = useRef<string | null>(null);
  const lastSentReadIdRef = useRef<string | null>(null);

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  useEffect(() => {
    if (!lastMessage) return;
    const targetId = lastMessage.messageId;

    if (lastSentReadIdRef.current !== null && targetId <= lastSentReadIdRef.current) {
      return;
    }
    if (summary?.lastReadMessageId && targetId <= summary.lastReadMessageId) {
      return;
    }
    if (sendingRef.current === targetId) {
      return;
    }

    sendingRef.current = targetId;

    void (async () => {
      try {
        const res = await client.post(`/me/conversations/${conversationId}/read`, {
          body: { messageId: targetId },
          schema: markConversationReadResponseSchema,
        });
        lastSentReadIdRef.current = res.lastReadMessageId;
        queryClient.setQueryData<ConversationListResponse>(CONVERSATIONS_QUERY_KEY, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.conversationId === conversationId
                ? {
                    ...item,
                    lastReadMessageId: res.lastReadMessageId,
                    unreadCount: res.unreadCount,
                  }
                : item,
            ),
          };
        });
      } catch {
        // Lỗi thì cho gửi lại lần sau
      } finally {
        if (sendingRef.current === targetId) {
          sendingRef.current = null;
        }
      }
    })();
  }, [conversationId, lastMessage?.messageId, summary?.lastReadMessageId, client, queryClient]);
}

export function useIcebreakers(
  conversationId: string,
  enabled = true,
): UseQueryResult<IcebreakersResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['chat', conversationId, 'icebreakers'] as const,
    queryFn: () =>
      client.get(`/me/conversations/${conversationId}/icebreakers`, {
        schema: icebreakersResponseSchema,
      }),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
