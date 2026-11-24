import { useEffect, useState, type ReactNode } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import type { DatePlanDto } from '@tamgiao/contracts/dating';
import { EmptyState, ErrorState, Text } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { type Clock, systemClock } from './clock.js';
import { DATES_COPY } from './copy.js';
import { DatePlanCard } from './date-plan-card.js';
import { DateProposalForm } from './date-proposal-form.js';
import { dateViewFor, type DateView } from './date-view.js';
import { useCurrentMatch } from '../match/use-match.js';
import { usePartners } from '../kyc/use-verification-status.js';
import { useCurrentDate, useDatePushRefresh } from './use-dates.js';

export interface DatesScreenProps {
  readonly clock?: Clock;
  /** Thao tác thêm dưới thẻ lịch hẹn (check-in, voucher, đánh giá). */
  readonly renderActions?: (plan: DatePlanDto, view: DateView) => ReactNode;
}

export function DatesScreen({ clock = systemClock, renderActions }: DatesScreenProps) {
  const router = useRouter();
  const datesQuery = useCurrentDate();
  const matchQuery = useCurrentMatch();
  const partnersQuery = usePartners();

  useDatePushRefresh();

  const [now, setNow] = useState(() => clock.now());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setNow(clock.now());
    const intervalId = setInterval(() => {
      setNow(clock.now());
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [clock]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([datesQuery.refetch(), matchQuery.refetch(), partnersQuery.refetch()]);
    setNow(clock.now());
    setRefreshing(false);
  };

  const isInitialLoading = datesQuery.isLoading || matchQuery.isLoading;
  // Chưa có match thì không biết được đặt lịch hay không → lỗi tải match cũng là lỗi màn (trừ khi đã có lịch để xem).
  const initialError =
    datesQuery.data === undefined
      ? datesQuery.error
      : datesQuery.data.datePlan === null && matchQuery.data === undefined
        ? matchQuery.error
        : null;

  if (isInitialLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="title-md" className="font-semibold text-primary">
          {DATES_COPY.loading}
        </Text>
      </View>
    );
  }

  if (initialError !== null) {
    const errorTitle = messageFor(isApiError(initialError) ? initialError : { code: 'UNKNOWN' }).title;

    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={errorTitle}
          onRetry={() => {
            void Promise.all([datesQuery.refetch(), matchQuery.refetch()]);
          }}
        />
      </View>
    );
  }

  const plan = datesQuery.data?.datePlan ?? null;
  const match = matchQuery.data?.match ?? null;
  const view = dateViewFor(plan, now);

  const isMatchInDatingPhase = match !== null && (match.phase === 'DATING' || match.phase === 'MET');

  const showNotDatingEmptyState = !isMatchInDatingPhase && plan === null;

  const currentPartner =
    plan !== null && partnersQuery.data?.items
      ? (partnersQuery.data.items.find((p) => p.id === plan.partnerId) ?? null)
      : null;

  return (
    <View className="flex-1 bg-surface">
      {/* Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-margin flex-row items-center gap-space-sm">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={DATES_COPY.header.back}
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
              {DATES_COPY.header.backIcon}
            </Text>
          </Pressable>
          <Text variant="title-md" numberOfLines={1} className="font-semibold text-on-surface flex-1">
            {DATES_COPY.header.title}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 48 }}
        className="flex-1 px-margin"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.primary}
          />
        }
      >
        <View className="py-space-md gap-space-md max-w-md mx-auto w-full">
          {showNotDatingEmptyState ? (
            <EmptyState title={DATES_COPY.notDating.title} description={DATES_COPY.notDating.description} />
          ) : (
            <>
              {plan !== null ? (
                <DatePlanCard
                  plan={plan}
                  view={view}
                  partner={currentPartner}
                  counterpartName={match?.counterpart?.displayName}
                  onRefresh={() => void handleRefresh()}
                  renderActions={renderActions}
                />
              ) : null}

              {view.canProposeNew && match?.phase === 'DATING' ? (
                <DateProposalForm
                  now={now}
                  matchExpiresAt={match.expiresAt}
                  counterpartName={match?.counterpart?.displayName}
                />
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
