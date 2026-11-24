import { useCallback, useMemo, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import type { ConversationSummaryDto } from '@tamgiao/contracts/messaging';
import { EmptyState, ErrorState, Text } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { ConversationRow } from './conversation-row.js';
import { INBOX_COPY } from './copy.js';
import { useInbox } from './use-inbox.js';

type ListItem =
  | { type: 'header'; key: string; title: string; count: number }
  | { type: 'conversation'; key: string; conversation: ConversationSummaryDto };

function InboxHeader({ onBack }: { onBack: () => void }) {
  return (
    <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
      <View className="h-16 px-margin flex-row items-center gap-space-sm">
        <Pressable
          testID="inbox-back"
          accessibilityRole="button"
          accessibilityLabel={INBOX_COPY.header.back}
          onPress={onBack}
          className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
        >
          <Text variant="title-md" className="text-secondary font-bold">
            {INBOX_COPY.header.backIcon}
          </Text>
        </Pressable>
        <Text variant="title-md" className="font-bold text-on-surface flex-1">
          {INBOX_COPY.header.title}
        </Text>
      </View>
    </View>
  );
}

export function InboxScreen() {
  const router = useRouter();
  const inboxQuery = useInbox();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(main)/home');
    }
  }, [router]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await inboxQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [inboxQuery]);

  const items = inboxQuery.data?.items;
  const openConversations = useMemo(() => (items ?? []).filter((c) => c.status === 'OPEN'), [items]);
  const closedConversations = useMemo(() => (items ?? []).filter((c) => c.status === 'CLOSED'), [items]);

  const listData = useMemo<ListItem[]>(() => {
    const result: ListItem[] = [];
    if (openConversations.length > 0) {
      result.push({
        type: 'header',
        key: 'section-open',
        title: INBOX_COPY.sections.open,
        count: openConversations.length,
      });
      for (const c of openConversations) {
        result.push({
          type: 'conversation',
          key: c.conversationId,
          conversation: c,
        });
      }
    }
    if (closedConversations.length > 0) {
      result.push({
        type: 'header',
        key: 'section-closed',
        title: INBOX_COPY.sections.closed,
        count: closedConversations.length,
      });
      for (const c of closedConversations) {
        result.push({
          type: 'conversation',
          key: c.conversationId,
          conversation: c,
        });
      }
    }
    return result;
  }, [openConversations, closedConversations]);

  if (inboxQuery.isLoading) {
    return (
      <View className="flex-1 bg-surface">
        <InboxHeader onBack={handleBack} />
        <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="title-md" className="font-semibold text-primary">
            {INBOX_COPY.loading}
          </Text>
        </View>
      </View>
    );
  }

  if (inboxQuery.isError && inboxQuery.data === undefined) {
    const errorTitle = isApiError(inboxQuery.error)
      ? messageFor(inboxQuery.error).title
      : INBOX_COPY.genericError;
    return (
      <View className="flex-1 bg-surface">
        <InboxHeader onBack={handleBack} />
        <View className="flex-1 items-center justify-center bg-surface p-space-md">
          <ErrorState
            title={errorTitle}
            action={INBOX_COPY.retry}
            onRetry={() => {
              void inboxQuery.refetch();
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface">
      <InboxHeader onBack={handleBack} />

      <FlatList
        testID="inbox-list"
        data={listData}
        keyExtractor={(item) => item.key}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={
          listData.length === 0 ? { flexGrow: 1, justifyContent: 'center' } : { paddingBottom: 40 }
        }
        ListEmptyComponent={
          <EmptyState title={INBOX_COPY.empty.title} description={INBOX_COPY.empty.description} />
        }
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return (
              <View className="px-margin pt-space-md pb-space-xs flex-row items-center justify-between">
                <Text variant="title-md" className="font-bold text-on-surface">
                  {item.title}
                </Text>
                <Text variant="label-sm" className="text-secondary font-medium">
                  {item.count.toString()}
                </Text>
              </View>
            );
          }
          return <ConversationRow conversation={item.conversation} />;
        }}
      />
    </View>
  );
}
