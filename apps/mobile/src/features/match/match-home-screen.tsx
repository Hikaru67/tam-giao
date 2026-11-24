import { useCallback, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { Button, Card, EmptyState, ErrorState, Text } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { MATCH_COPY } from './copy.js';
import { MatchOfferCard } from './match-offer-card.js';
import { useCurrentMatch, useMatchPushRefresh, useRefreshMatch } from './use-match.js';

export function MatchHomeScreen() {
  const router = useRouter();
  const matchQuery = useCurrentMatch();
  useMatchPushRefresh();
  const refresh = useRefreshMatch();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh]);

  if (matchQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="title-md" className="font-semibold text-primary">
          {MATCH_COPY.loading}
        </Text>
      </View>
    );
  }

  // Lỗi khi làm mới nền (đã có dữ liệu) không che màn đang xem.
  if (matchQuery.isError && matchQuery.data === undefined) {
    const errorTitle = isApiError(matchQuery.error)
      ? messageFor(matchQuery.error).title
      : MATCH_COPY.genericError;
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={errorTitle}
          onRetry={() => {
            void matchQuery.refetch();
          }}
        />
      </View>
    );
  }

  const match = matchQuery.data?.match ?? null;

  return (
    <View className="flex-1 bg-surface">
      {/* Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-margin flex-row items-center justify-between">
          <Text variant="title-md" className="font-bold text-on-surface">
            {MATCH_COPY.header.title}
          </Text>
          <Pressable
            testID="match-settings"
            accessibilityRole="button"
            accessibilityLabel={MATCH_COPY.header.settings}
            onPress={() => router.push('/(main)/settings')}
            className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
          >
            <Text variant="title-md" className="text-secondary font-bold">
              ⚙
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        testID="match-scroll"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 60 }}
        className="flex-1 px-margin"
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        <View className="py-space-md gap-space-md max-w-md mx-auto w-full">
          {match === null ? (
            <View testID="match-searching">
              <EmptyState
                title={MATCH_COPY.searching.title}
                description={MATCH_COPY.searching.description}
                action={
                  <Button
                    variant="secondary"
                    size="md"
                    onPress={() => {
                      void matchQuery.refetch();
                    }}
                  >
                    {MATCH_COPY.searching.refresh}
                  </Button>
                }
              />
            </View>
          ) : null}

          {match !== null &&
          (match.phase === 'NEEDS_MY_RESPONSE' || match.phase === 'COUNTERPART_ACCEPTED') ? (
            <MatchOfferCard key={match.matchId} match={match} />
          ) : null}

          {match !== null &&
          (match.phase === 'WAITING_FOR_COUNTERPART' || match.phase === 'DATING' || match.phase === 'MET') ? (
            <Card testID={`match-phase-${match.phase}`} className="gap-space-xs">
              <Text variant="title-md" className="font-bold text-on-surface">
                {MATCH_COPY.phases[match.phase].title}
              </Text>
              <Text variant="body-md" className="text-secondary leading-relaxed">
                {MATCH_COPY.phases[match.phase].description}
              </Text>
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
