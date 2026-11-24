import { useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import type { DatePlanDto } from '@tamgiao/contracts/dating';
import { Badge, Button, Card, Text, useToast } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { ActivityIndicator, Pressable, Switch, View } from 'react-native';
import { formatLocalTime } from '../date-options.js';
import type { DateView } from '../date-view.js';
import { CHECK_IN_COPY } from './copy.js';
import { useCheckIn, useCheckOut, useMyCheckIn } from './use-check-in.js';

export interface CheckInCardProps {
  readonly plan: DatePlanDto;
  readonly view: DateView;
  readonly now?: Date | undefined;
}

export function CheckInCard({ plan, view, now }: CheckInCardProps) {
  const { showToast } = useToast();
  const [shareLocation, setShareLocation] = useState(false);

  const isConfirmed = view.kind === 'confirmed';
  const isInProgress = view.kind === 'in_progress';
  // `completed`: đã gửi đánh giá nhưng có thể chưa check-out — vẫn phải check-out được để không báo động nhầm.
  const isAfterDate = view.kind === 'awaiting_feedback' || view.kind === 'completed';

  const shouldRenderCard = isConfirmed || isInProgress || isAfterDate;
  const checkInQuery = useMyCheckIn(plan.id, isInProgress || isAfterDate, isInProgress);

  const checkInMutation = useCheckIn(plan.id);
  const checkOutMutation = useCheckOut(plan.id);

  if (!shouldRenderCard) {
    return null;
  }

  if (isConfirmed) {
    return (
      <Card className="gap-space-xs mt-space-sm bg-surface-container-low border border-surface-container-high/60">
        <Text variant="title-md" className="font-semibold text-on-surface">
          {CHECK_IN_COPY.cardTitle}
        </Text>
        <Text variant="body-sm" className="text-secondary">
          {CHECK_IN_COPY.confirmedNotice(formatLocalTime(plan.startsAt), formatLocalTime(plan.endsAt))}
        </Text>
      </Card>
    );
  }

  const checkIn = checkInQuery.data?.checkIn ?? null;

  // Sau buổi hẹn mà chưa từng check-in → không có gì để làm.
  if (isAfterDate && checkIn === null) {
    return null;
  }

  const handleCheckIn = async () => {
    try {
      const result = await checkInMutation.mutateAsync({ shareLocation });
      if (result.locationRequestedButMissing) {
        showToast(CHECK_IN_COPY.toasts.successWithoutLocation, 'warning');
      } else {
        showToast(CHECK_IN_COPY.toasts.successWithLocation, 'success');
      }
    } catch (err) {
      showToast(messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title, 'danger');
    }
  };

  const handleCheckOut = async () => {
    try {
      await checkOutMutation.mutateAsync();
      showToast(CHECK_IN_COPY.toasts.checkOutSuccess, 'success');
    } catch (err) {
      showToast(messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title, 'danger');
    }
  };

  const currentTime = now !== undefined ? now.getTime() : Date.now();
  const endsAtTime = new Date(plan.endsAt).getTime();
  const isPastEndsAt = view.kind === 'awaiting_feedback' || currentTime > endsAtTime;

  return (
    <Card className="gap-space-sm mt-space-sm border border-surface-container-high">
      <View className="flex-row items-center justify-between">
        <Text variant="title-md" className="font-semibold text-on-surface">
          {CHECK_IN_COPY.cardTitle}
        </Text>
      </View>

      {/* Lỗi GET: hiện dòng lỗi nhỏ + thử lại, không chặn màn */}
      {checkInQuery.isError && checkInQuery.data === undefined ? (
        <View className="flex-row items-center justify-between p-space-xs rounded bg-surface-container-low border border-outline-variant/40">
          <Text variant="body-sm" className="text-error font-medium">
            {CHECK_IN_COPY.errors.loadFailed}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void checkInQuery.refetch()}>
            <Text variant="label-sm" className="text-primary font-semibold">
              {CHECK_IN_COPY.actions.retry}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {checkInQuery.data === undefined ? (
        // Chưa biết đã check-in hay chưa (quán có thể đã quét voucher) → chưa cho bấm.
        checkInQuery.isError ? null : (
          <ActivityIndicator testID="checkin-loading" size="small" color={colors.primary} />
        )
      ) : checkIn === null ? (
        /* in_progress, chưa check-in */
        <View className="gap-space-sm">
          <View className="gap-space-xs">
            <View className="flex-row items-center justify-between">
              <Text variant="body-md" className="text-on-surface font-medium flex-1 pr-space-sm">
                {CHECK_IN_COPY.shareLocationLabel}
              </Text>
              <Switch
                testID="checkin-share-location"
                value={shareLocation}
                onValueChange={setShareLocation}
                trackColor={{ false: colors['surface-container-high'], true: colors.primary }}
              />
            </View>
            <Text variant="body-sm" className="text-secondary">
              {CHECK_IN_COPY.shareLocationHint}
            </Text>
          </View>

          <Button
            testID="checkin-submit"
            variant="primary"
            size="md"
            loading={checkInMutation.isPending}
            disabled={checkInMutation.isPending}
            onPress={() => void handleCheckIn()}
          >
            {CHECK_IN_COPY.actions.checkIn}
          </Button>
        </View>
      ) : checkIn.checkedOutAt === null ? (
        /* đã check-in, chưa check-out */
        <View className="gap-space-sm">
          <View className="flex-row flex-wrap items-center gap-space-xs">
            <Text variant="body-md" className="font-semibold text-on-surface">
              {CHECK_IN_COPY.checkedInAt(formatLocalTime(checkIn.checkedInAt))}
            </Text>
            <Badge tone="neutral">{CHECK_IN_COPY.sources[checkIn.source]}</Badge>
            {checkIn.locationShared ? (
              <Badge tone="primary">{CHECK_IN_COPY.locationSharedBadge}</Badge>
            ) : null}
          </View>

          {isPastEndsAt ? (
            <View
              testID="checkin-overdue-hint"
              accessibilityRole="alert"
              className="p-space-sm rounded-lg bg-surface-container gap-1"
            >
              <Text variant="body-sm" className="text-secondary">
                {CHECK_IN_COPY.overdueHint}
              </Text>
            </View>
          ) : null}

          <Button
            testID="checkin-out"
            variant="secondary"
            size="md"
            loading={checkOutMutation.isPending}
            disabled={checkOutMutation.isPending}
            onPress={() => void handleCheckOut()}
          >
            {CHECK_IN_COPY.actions.checkOut}
          </Button>
        </View>
      ) : (
        /* đã check-out */
        <View className="gap-space-xs">
          <View className="flex-row flex-wrap items-center gap-space-xs">
            <Text variant="body-md" className="font-semibold text-on-surface">
              {CHECK_IN_COPY.checkedOutAt(formatLocalTime(checkIn.checkedOutAt))}
            </Text>
            <Badge tone="success">{CHECK_IN_COPY.sources[checkIn.source]}</Badge>
            {checkIn.locationShared ? (
              <Badge tone="primary">{CHECK_IN_COPY.locationSharedBadge}</Badge>
            ) : null}
          </View>
          <Text variant="body-sm" className="text-secondary">
            {CHECK_IN_COPY.checkedInAt(formatLocalTime(checkIn.checkedInAt))}
          </Text>
        </View>
      )}
    </Card>
  );
}
