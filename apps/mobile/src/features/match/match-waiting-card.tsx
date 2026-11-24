import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { DATING_DAYS, RESPONSE_TTL_HOURS } from '@tamgiao/contracts/constants';
import type { CurrentMatchDto } from '@tamgiao/contracts/matching';
import { Avatar, Badge, BottomSheet, Button, Card, Countdown, Text, useToast } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { MATCH_COPY } from './copy.js';
import { useRefreshMatch, useWithdrawMatch } from './use-match.js';

export function MatchWaitingCard({ match }: { match: CurrentMatchDto }) {
  const router = useRouter();
  const refreshMatch = useRefreshMatch();
  const withdrawMutation = useWithdrawMatch();
  const { showToast } = useToast();

  const [withdrawSheetOpen, setWithdrawSheetOpen] = useState(false);
  const [expiredAt, setExpiredAt] = useState<string | null>(null);

  const isPast = match.expiresAt !== null && new Date(match.expiresAt).getTime() <= Date.now();
  const isExpired = (expiredAt !== null && expiredAt === match.expiresAt) || isPast;

  const hasRefreshedOnPastRef = useRef(false);
  useEffect(() => {
    if (isPast && !hasRefreshedOnPastRef.current) {
      hasRefreshedOnPastRef.current = true;
      void refreshMatch();
    }
  }, [isPast, refreshMatch]);

  useEffect(() => {
    if (isExpired) {
      setWithdrawSheetOpen(false);
    }
  }, [isExpired]);

  const handleExpire = useCallback(() => {
    if (match.expiresAt !== null) {
      setExpiredAt(match.expiresAt);
      void refreshMatch();
    }
  }, [match.expiresAt, refreshMatch]);

  const handleConfirmWithdraw = async () => {
    if (isExpired || withdrawMutation.isPending) return;
    try {
      await withdrawMutation.mutateAsync();
      setWithdrawSheetOpen(false);
      showToast(MATCH_COPY.toast.withdrawn, 'success');
    } catch (err) {
      setWithdrawSheetOpen(false);
      const msg = messageFor(isApiError(err) ? err : { code: 'UNKNOWN' });
      showToast(msg.title, 'danger');
    }
  };

  const counterpart = match.counterpart;
  const titleText =
    counterpart !== null
      ? MATCH_COPY.waiting.title(counterpart.displayName)
      : MATCH_COPY.waiting.titleWithoutName;

  return (
    <Card testID="match-waiting" className="gap-space-md p-space-md bg-surface-container-lowest">
      <View className="flex-row items-center justify-between">
        <Badge tone="primary">{MATCH_COPY.waiting.badge}</Badge>
      </View>

      <Text variant="headline-sm" className="font-bold text-on-surface tracking-tight">
        {titleText}
      </Text>

      {counterpart !== null ? (
        <View className="flex-row items-center gap-space-md p-space-sm rounded-lg bg-surface-container-low">
          <Avatar
            {...(counterpart.avatar?.url ? { src: counterpart.avatar.url } : {})}
            initials={counterpart.displayName}
            size="lg"
          />
          <View className="flex-1 gap-0.5">
            <Text variant="title-md" className="font-bold text-on-surface">
              {MATCH_COPY.offer.nameAge(counterpart.displayName, counterpart.age)}
            </Text>
            <Text variant="body-sm" className="text-secondary">
              {counterpart.occupation}
            </Text>
            <Text variant="body-sm" className="text-secondary">
              {counterpart.currentCity}
            </Text>
          </View>
        </View>
      ) : (
        <View className="flex-row items-center gap-space-md p-space-sm rounded-lg bg-surface-container-low">
          <Avatar initials="?" size="lg" />
          <View className="flex-1">
            <Text variant="body-md" className="text-secondary">
              {MATCH_COPY.waiting.titleWithoutName}
            </Text>
          </View>
        </View>
      )}

      {isExpired ? (
        <View
          testID="match-waiting-expired"
          className="p-space-md rounded-lg bg-surface-container-low gap-space-sm"
        >
          <Text variant="title-md" className="font-bold text-on-surface">
            {MATCH_COPY.waiting.expiredTitle}
          </Text>
          <Text variant="body-md" className="text-secondary">
            {MATCH_COPY.waiting.expiredDescription}
          </Text>
          <Button
            variant="secondary"
            size="md"
            onPress={() => {
              void refreshMatch();
            }}
          >
            {MATCH_COPY.waiting.refresh}
          </Button>
        </View>
      ) : (
        <View className="gap-space-sm">
          <View className="bg-surface-container-low rounded-lg p-space-sm gap-space-xs">
            <View className="flex-row items-center justify-between">
              <Text variant="label-md" className="text-secondary">
                {MATCH_COPY.waiting.countdownPrefix}
              </Text>
              {match.expiresAt !== null ? (
                <Countdown key={match.expiresAt} expiresAt={match.expiresAt} onExpire={handleExpire} />
              ) : null}
            </View>
            <Text variant="body-sm" className="text-secondary">
              {MATCH_COPY.waiting.maxResponseHours(RESPONSE_TTL_HOURS)}
            </Text>
          </View>
          <Text variant="body-sm" className="text-secondary">
            {MATCH_COPY.waiting.expiredHint(RESPONSE_TTL_HOURS)}
          </Text>
        </View>
      )}

      <View className="p-space-md rounded-lg bg-surface-container-low gap-space-sm">
        <Text variant="title-md" className="font-bold text-on-surface">
          {MATCH_COPY.waiting.principlesTitle}
        </Text>
        <View className="gap-space-xs">
          <Text variant="body-sm" className="text-secondary">
            • {MATCH_COPY.waiting.principles.exclusive}
          </Text>
          <Text variant="body-sm" className="text-secondary">
            • {MATCH_COPY.waiting.principles.datingDays(DATING_DAYS)}
          </Text>
          <Text variant="body-sm" className="text-secondary">
            • {MATCH_COPY.waiting.principles.withdrawRight}
          </Text>
        </View>
      </View>

      <View className="gap-space-sm pt-space-xs">
        <Button
          variant="secondary"
          testID="match-view-profile"
          fullWidth
          disabled={counterpart === null}
          onPress={() => router.push('/(main)/match/profile')}
        >
          {MATCH_COPY.waiting.viewProfile}
        </Button>

        {!isExpired ? (
          <Button
            variant="ghost"
            testID="match-withdraw"
            fullWidth
            disabled={withdrawMutation.isPending}
            onPress={() => setWithdrawSheetOpen(true)}
          >
            {MATCH_COPY.waiting.withdraw}
          </Button>
        ) : null}
      </View>

      <BottomSheet
        open={withdrawSheetOpen && !isExpired}
        onClose={() => setWithdrawSheetOpen(false)}
        title={MATCH_COPY.withdrawSheet.title}
      >
        <View className="gap-space-md">
          <Text variant="body-md" className="text-secondary">
            {MATCH_COPY.withdrawSheet.body}
          </Text>
          <View className="gap-space-sm">
            <Button
              variant="danger"
              testID="match-withdraw-confirm"
              fullWidth
              loading={withdrawMutation.isPending}
              disabled={withdrawMutation.isPending}
              onPress={handleConfirmWithdraw}
            >
              {MATCH_COPY.withdrawSheet.confirm}
            </Button>
            <Button
              variant="ghost"
              fullWidth
              disabled={withdrawMutation.isPending}
              onPress={() => setWithdrawSheetOpen(false)}
            >
              {MATCH_COPY.withdrawSheet.cancel}
            </Button>
          </View>
        </View>
      </BottomSheet>
    </Card>
  );
}
