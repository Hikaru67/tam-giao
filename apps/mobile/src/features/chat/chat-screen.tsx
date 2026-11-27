import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import type { PendingMessage } from '@tamgiao/api-client/ws';
import type { ConversationMessageDto } from '@tamgiao/contracts/messaging';
import { Button, EmptyState, ErrorState, Text } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CONVERSATIONS_QUERY_KEY, CURRENT_MATCH_QUERY_KEY, useCurrentMatch } from '../match/index.js';
import { useIsPeerReported } from '../safety/reported-peers.js';
import { useScreenCaptureProtection } from '../security/use-screen-capture-protection.js';
import { useChatClient, useChatConnectionState } from './chat-client-context.js';
import { ChatComposer } from './chat-composer.js';
import { CHAT_COPY } from './copy.js';
import { MessageBubble } from './message-bubble.js';
import {
  useConversationMessages,
  useConversationSummary,
  useIcebreakers,
  useMarkRead,
} from './use-conversation.js';

export interface ChatScreenProps {
  conversationId: string;
}

export function ChatScreen({ conversationId }: ChatScreenProps) {
  useScreenCaptureProtection('chat');

  const router = useRouter();
  const queryClient = useQueryClient();
  const chatClient = useChatClient();
  const connectionState = useChatConnectionState();

  const {
    summary,
    isLoading: isSummaryLoading,
    isError: isSummaryError,
    error: summaryError,
    refetch: refetchSummary,
  } = useConversationSummary(conversationId);

  const currentMatchQuery = useCurrentMatch();
  const currentMatch = currentMatchQuery.data?.match ?? null;

  // Tên hiển thị chỉ có ở match đang mở; hội thoại của match cũ dùng nhãn chung.
  const counterpart = currentMatch?.counterpart ?? null;
  const peer = counterpart !== null && counterpart.userId === summary?.peerUserId ? counterpart : null;
  const peerDisplayName =
    peer !== null ? CHAT_COPY.header.nameAge(peer.displayName, peer.age) : CHAT_COPY.header.peerFallback;
  const peerSimpleName = peer !== null ? peer.displayName : CHAT_COPY.header.peerFallback;

  const {
    messages,
    pending,
    isLoading: isMessagesLoading,
    isError: isMessagesError,
    error: messagesError,
    refetch: refetchMessages,
    hasOlder,
    loadOlder,
    isLoadingOlder,
    peerReadMessageId,
    closedByServer,
    forbidden,
  } = useConversationMessages(conversationId);

  useMarkRead(conversationId, messages, summary);

  const isReported = useIsPeerReported(summary?.peerUserId ?? null);
  const isClosed = summary?.status === 'CLOSED' || closedByServer || isReported;

  // Khi server báo đóng hội thoại lần đầu → invalidate cache
  const prevClosedRef = useRef(false);
  useEffect(() => {
    if (closedByServer && !prevClosedRef.current) {
      prevClosedRef.current = true;
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: CURRENT_MATCH_QUERY_KEY });
    }
  }, [closedByServer, queryClient]);

  const [composerText, setComposerText] = useState('');

  const icebreakersQuery = useIcebreakers(conversationId, !isClosed && !forbidden && summary !== null);

  const handleSend = useCallback(
    (text: string) => {
      chatClient.send(conversationId, text);
    },
    [chatClient, conversationId],
  );

  const handleRetry = useCallback(
    (clientMessageId: string) => {
      chatClient.retry(clientMessageId);
    },
    [chatClient],
  );

  const handleDiscard = useCallback(
    (clientMessageId: string) => {
      chatClient.discard(clientMessageId);
    },
    [chatClient],
  );

  // Khử trùng pending: những pending nào đã có message trong messages với cùng clientMessageId thì bỏ qua
  const confirmedClientMsgIds = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of messages) {
      if (msg.clientMessageId) {
        ids.add(msg.clientMessageId);
      }
    }
    return ids;
  }, [messages]);

  const filteredPending = useMemo(() => {
    return pending.filter((p) => !confirmedClientMsgIds.has(p.clientMessageId));
  }, [pending, confirmedClientMsgIds]);

  // Dữ liệu cho FlatList inverted: [pending mới nhất..., messages đảo ngược]
  const listData: Array<ConversationMessageDto | PendingMessage> = useMemo(() => {
    const reversedPending = [...filteredPending].reverse();
    const reversedMessages = [...messages].reverse();
    return [...reversedPending, ...reversedMessages];
  }, [filteredPending, messages]);

  // Tin mình gửi cuối cùng có messageId <= peerReadMessageId → hiển thị "Đã đọc"
  const lastReadMyMessageId = useMemo(() => {
    if (!peerReadMessageId || !summary?.peerUserId) return null;
    const peerUserId = summary.peerUserId;
    const myMessages = messages.filter((m) => m.senderId !== null && m.senderId !== peerUserId);
    const readMyMessages = myMessages.filter((m) => m.messageId <= peerReadMessageId);
    return readMyMessages.length > 0 ? readMyMessages[readMyMessages.length - 1]!.messageId : null;
  }, [peerReadMessageId, summary?.peerUserId, messages]);

  if (!isSummaryLoading && (forbidden || (summary === null && !isSummaryError))) {
    return (
      <View className="flex-1 bg-surface justify-center p-space-md">
        <EmptyState
          title={CHAT_COPY.empty.title}
          description={CHAT_COPY.empty.description}
          action={
            <Button variant="primary" size="md" onPress={() => router.replace('/(main)/home')}>
              {CHAT_COPY.empty.backHome}
            </Button>
          }
        />
      </View>
    );
  }

  if ((isSummaryLoading && summary === null) || (isMessagesLoading && messages.length === 0)) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="title-md" className="font-semibold text-primary">
          {CHAT_COPY.loading}
        </Text>
      </View>
    );
  }

  if ((isSummaryError && summary === null) || (isMessagesError && messages.length === 0)) {
    const err = summaryError ?? messagesError;
    const errorTitle = isApiError(err) ? messageFor(err).title : CHAT_COPY.genericError;
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={errorTitle}
          onRetry={() => {
            void refetchSummary();
            void refetchMessages();
          }}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-surface"
      {...(Platform.OS === 'ios' ? { behavior: 'padding' as const } : {})}
    >
      {/* Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-margin flex-row items-center gap-space-sm">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={CHAT_COPY.header.back}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(main)/home');
              }
            }}
            className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
          >
            <Text variant="title-md" className="text-primary font-bold">
              {CHAT_COPY.header.backIcon}
            </Text>
          </Pressable>
          <Text variant="title-md" numberOfLines={1} className="font-semibold text-on-surface flex-1">
            {peerDisplayName}
          </Text>
          {summary?.peerUserId ? (
            <Pressable
              testID="chat-report"
              accessibilityRole="button"
              accessibilityLabel={CHAT_COPY.header.report}
              onPress={() => {
                router.push({
                  pathname: '/(main)/safety/report',
                  params: { reportedUserId: summary.peerUserId },
                });
              }}
              className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
            >
              <Text variant="label-md" className="text-secondary font-bold">
                !
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Banner kết nối */}
      {connectionState === 'connecting' || connectionState === 'reconnecting' ? (
        <View className="bg-tertiary-fixed py-1 px-margin items-center">
          <Text variant="label-sm" className="text-on-tertiary-fixed font-medium">
            {CHAT_COPY.connection.reconnecting}
          </Text>
        </View>
      ) : null}

      {connectionState === 'signed_out' ? (
        <View className="bg-error-container py-1 px-margin items-center">
          <Text variant="label-sm" className="text-on-error-container font-medium">
            {CHAT_COPY.connection.signedOut}
          </Text>
        </View>
      ) : null}

      {/* Thanh tiến trình */}
      {summary ? (
        <View
          testID="chat-progress"
          className="px-margin py-space-xs bg-surface-container-lowest border-b border-surface-container-high/40"
        >
          <View className="flex-row items-center justify-between mb-1">
            <Text variant="label-md" className="font-semibold text-on-surface">
              {CHAT_COPY.progress.day(summary.datingDay, summary.datingDays)}
            </Text>
            <Text variant="label-sm" className="text-secondary">
              {CHAT_COPY.progress.remaining(Math.max(0, summary.datingDays - summary.datingDay))}
            </Text>
          </View>
          <View className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
            <View
              className="bg-primary h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, (summary.datingDay / summary.datingDays) * 100))}%`,
              }}
            />
          </View>
        </View>
      ) : null}

      {/* Banner an toàn */}
      <View className="px-margin py-space-xs bg-surface-container-low border-b border-surface-container-high/40 flex-row items-center gap-space-xs">
        <Text variant="body-sm" className="text-secondary flex-1">
          {CHAT_COPY.safety.body}
        </Text>
      </View>

      {/* Danh sách tin nhắn */}
      <FlatList
        testID="chat-list"
        inverted
        data={listData}
        keyExtractor={(item) => ('messageId' in item ? item.messageId : item.clientMessageId)}
        onEndReached={() => {
          if (hasOlder && !isLoadingOlder) {
            loadOlder();
          }
        }}
        onEndReachedThreshold={0.2}
        renderItem={({ item }) => (
          <MessageBubble
            item={item}
            peerUserId={summary?.peerUserId ?? null}
            peerName={peerSimpleName}
            isRead={'messageId' in item && item.messageId === lastReadMyMessageId}
            onRetry={handleRetry}
            onDiscard={handleDiscard}
          />
        )}
        {...(isLoadingOlder
          ? {
              ListFooterComponent: (
                <View className="py-space-sm items-center">
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ),
            }
          : {})}
      />

      {/* Icebreakers gợi ý phá băng */}
      {!isClosed && icebreakersQuery.data && icebreakersQuery.data.topics.length > 0 ? (
        <View className="py-space-xs px-margin bg-surface">
          <Text variant="label-sm" className="text-secondary mb-1">
            {icebreakersQuery.data.theme}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-space-xs py-0.5"
          >
            {icebreakersQuery.data.topics.map((topic, idx) => (
              <Pressable
                key={idx}
                onPress={() => setComposerText(topic)}
                className="bg-surface-container-high active:bg-surface-container-highest px-3 py-1.5 rounded-full"
              >
                <Text variant="label-sm" className="text-on-surface">
                  {topic}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Chỉ đọc hoặc Khung soạn thảo tin nhắn */}
      {isClosed ? (
        <View
          testID="chat-readonly"
          className="p-space-md bg-surface-container-low items-center gap-1 border-t border-surface-container-high/40"
        >
          <Text variant="label-md" className="font-bold text-on-surface">
            {CHAT_COPY.readonly.title}
          </Text>
          <Text variant="body-sm" className="text-secondary text-center">
            {CHAT_COPY.readonly.description}
          </Text>
        </View>
      ) : (
        <ChatComposer
          text={composerText}
          setText={setComposerText}
          onSend={handleSend}
          placeholder={
            peer !== null
              ? CHAT_COPY.composer.placeholderWithName(peer.displayName)
              : CHAT_COPY.composer.placeholder
          }
        />
      )}
    </KeyboardAvoidingView>
  );
}
