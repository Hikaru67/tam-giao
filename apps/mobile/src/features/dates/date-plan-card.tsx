import { useState, type ReactNode } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import type { PartnerDto } from '@tamgiao/contracts/billing';
import { DATE_CANCEL_CUTOFF_HOURS, DATE_RESPONSE_TTL_HOURS } from '@tamgiao/contracts/constants';
import type { DatePlanDto } from '@tamgiao/contracts/dating';
import {
  Badge,
  type BadgeTone,
  BottomSheet,
  Button,
  Card,
  Countdown,
  Text,
  useToast,
} from '@tamgiao/ui-mobile';
import { View } from 'react-native';
import { DATES_COPY } from './copy.js';
import { formatLocalDate, formatLocalTime } from './date-options.js';
import type { DateView } from './date-view.js';
import { useCancelDate, useRespondDate } from './use-dates.js';

export interface DatePlanCardProps {
  readonly plan: DatePlanDto;
  readonly view: DateView;
  readonly partner: PartnerDto | null;
  readonly counterpartName?: string | undefined;
  readonly onRefresh?: () => void;
  readonly renderActions?: ((plan: DatePlanDto, view: DateView) => ReactNode) | undefined;
}

const statusToneMap = {
  PROPOSED: 'warning',
  CONFIRMED: 'success',
  CHECKED_IN: 'primary',
  COMPLETED: 'success',
  DECLINED: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
} as const satisfies Record<DatePlanDto['status'], BadgeTone>;

export function DatePlanCard({
  plan,
  view,
  partner,
  counterpartName,
  onRefresh,
  renderActions,
}: DatePlanCardProps) {
  const { showToast } = useToast();
  const respondMutation = useRespondDate();
  const cancelMutation = useCancelDate();

  const [confirmSheetOpen, setConfirmSheetOpen] = useState(false);
  const [declineSheetOpen, setDeclineSheetOpen] = useState(false);
  const [cancelSheetOpen, setCancelSheetOpen] = useState(false);

  const isPending = respondMutation.isPending || cancelMutation.isPending;

  const handleRespond = async (action: 'confirm' | 'decline') => {
    try {
      await respondMutation.mutateAsync({ id: plan.id, action });
      if (action === 'confirm') {
        setConfirmSheetOpen(false);
        showToast(DATES_COPY.toasts.confirmed, 'success');
      } else {
        setDeclineSheetOpen(false);
        showToast(DATES_COPY.toasts.declined, 'success');
      }
    } catch (err) {
      if (action === 'confirm') {
        setConfirmSheetOpen(false);
      } else {
        setDeclineSheetOpen(false);
      }

      showToast(messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title, 'danger');
    }
  };

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(plan.id);
      setCancelSheetOpen(false);
      showToast(DATES_COPY.toasts.cancelled, 'success');
    } catch (err) {
      setCancelSheetOpen(false);
      // Thông điệp chung của mã này nói về lịch phỏng vấn → dùng câu riêng cho lịch hẹn.
      const message =
        isApiError(err) && err.code === 'CANCEL_TOO_LATE'
          ? DATES_COPY.errors.cancelTooLate(DATE_CANCEL_CUTOFF_HOURS)
          : messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title;
      showToast(message, 'danger');
    }
  };

  const partnerName = partner?.name ?? DATES_COPY.partnerFallback;
  const statusLabel = DATES_COPY.card.statusBadge[plan.status];
  const badgeTone = statusToneMap[plan.status];

  return (
    <>
      <Card className="gap-space-sm">
        {/* Header card */}
        <View className="flex-row items-center justify-between">
          <Text variant="title-md" className="font-bold text-on-surface">
            {DATES_COPY.card.title}
          </Text>
          <Badge tone={badgeTone}>{statusLabel}</Badge>
        </View>

        {/* Thông tin quán */}
        <View className="gap-space-xs">
          <Text variant="title-md" className="font-semibold text-primary">
            {partnerName}
          </Text>
          {partner !== null ? (
            <Text variant="body-sm" className="text-secondary">
              {partner.address}
            </Text>
          ) : null}
          {partner && partner.tags.length > 0 ? (
            <View className="flex-row flex-wrap gap-space-xs mt-space-xs">
              {partner.tags.map((tag) => (
                <View
                  key={tag}
                  className="px-space-sm py-0.5 rounded-full bg-surface-container border border-surface-container-high"
                >
                  <Text variant="label-sm" className="text-secondary">
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Thông tin ngày giờ */}
        <View className="p-space-sm rounded-lg bg-surface-container-low gap-1">
          <Text variant="title-md" className="font-semibold text-on-surface">
            {DATES_COPY.when(
              formatLocalDate(plan.startsAt),
              formatLocalTime(plan.startsAt),
              formatLocalTime(plan.endsAt),
            )}
          </Text>
          {plan.staffBookingRequested ? (
            <Text variant="body-sm" className="text-secondary font-medium">
              {DATES_COPY.card.staffBookingBadge}
            </Text>
          ) : null}
        </View>

        {/* View content */}
        {view.kind === 'proposed_invitee' ? (
          <View className="gap-space-sm mt-space-xs">
            <Text variant="body-md" className="text-secondary font-medium">
              {DATES_COPY.card.views.proposedInvitee}
            </Text>
            <Countdown
              key={plan.expiresAt}
              expiresAt={plan.expiresAt}
              {...(onRefresh ? { onExpire: onRefresh } : {})}
            />
            <View className="flex-row gap-space-sm mt-space-xs">
              <Button
                testID="date-confirm"
                variant="primary"
                size="md"
                disabled={isPending}
                onPress={() => setConfirmSheetOpen(true)}
              >
                {DATES_COPY.card.actions.confirm}
              </Button>
              <Button
                testID="date-decline"
                variant="ghost"
                size="md"
                disabled={isPending}
                onPress={() => setDeclineSheetOpen(true)}
              >
                {DATES_COPY.card.actions.decline}
              </Button>
            </View>
          </View>
        ) : null}

        {view.kind === 'proposed_inviter' ? (
          <View className="gap-space-xs mt-space-xs">
            <Countdown
              key={plan.expiresAt}
              expiresAt={plan.expiresAt}
              {...(onRefresh ? { onExpire: onRefresh } : {})}
            />
            <Text variant="body-md" className="text-secondary leading-relaxed">
              {counterpartName
                ? DATES_COPY.card.views.proposedInviter(counterpartName, DATE_RESPONSE_TTL_HOURS)
                : DATES_COPY.card.views.proposedInviterGeneric(DATE_RESPONSE_TTL_HOURS)}
            </Text>
          </View>
        ) : null}

        {view.kind === 'proposed_expired' ? (
          <View className="gap-space-sm mt-space-xs">
            <Text variant="body-md" className="text-secondary">
              {DATES_COPY.card.views.proposedExpired}
            </Text>
            {onRefresh ? (
              <Button variant="secondary" size="md" onPress={onRefresh}>
                {DATES_COPY.card.actions.refresh}
              </Button>
            ) : null}
          </View>
        ) : null}

        {view.kind === 'confirmed' ? (
          <View className="gap-space-sm mt-space-xs">
            <Text variant="body-md" className="text-secondary font-medium">
              {DATES_COPY.card.views.confirmed}
            </Text>

            {view.cancelLocked ? (
              <View accessibilityRole="alert" className="p-space-sm rounded-lg bg-surface-container gap-1">
                <Text testID="date-cancel-locked-hint" variant="body-sm" className="text-secondary">
                  {DATES_COPY.card.cancelCutoffNotice(
                    DATE_CANCEL_CUTOFF_HOURS,
                    `${formatLocalTime(plan.cancelDeadline)} ${formatLocalDate(plan.cancelDeadline)}`,
                  )}
                </Text>
              </View>
            ) : null}

            <View className="flex-row gap-space-sm mt-space-xs">
              <Button
                testID="date-cancel"
                variant="ghost"
                size="md"
                disabled={view.cancelLocked || isPending}
                onPress={() => {
                  if (view.canCancel) {
                    setCancelSheetOpen(true);
                  }
                }}
              >
                {DATES_COPY.card.actions.cancel}
              </Button>
            </View>
          </View>
        ) : null}

        {view.kind === 'in_progress' ? (
          <View className="gap-space-xs mt-space-xs">
            <Text variant="body-md" className="text-secondary">
              {DATES_COPY.card.views.inProgress}
            </Text>
          </View>
        ) : null}

        {view.kind === 'awaiting_feedback' ? (
          <View className="gap-space-xs mt-space-xs">
            <Text variant="body-md" className="text-secondary">
              {DATES_COPY.card.views.awaitingFeedback}
            </Text>
          </View>
        ) : null}

        {view.kind === 'completed' ? (
          <View className="gap-space-xs mt-space-xs">
            <Text variant="body-md" className="text-secondary">
              {DATES_COPY.card.views.completed}
            </Text>
          </View>
        ) : null}

        {view.kind === 'ended' ? (
          <View className="gap-space-xs mt-space-xs">
            <Text variant="body-md" className="text-secondary">
              {plan.status === 'DECLINED'
                ? DATES_COPY.card.views.endedDeclined
                : plan.status === 'EXPIRED'
                  ? DATES_COPY.card.views.endedExpired
                  : DATES_COPY.card.views.endedCancelled}
            </Text>
          </View>
        ) : null}

        {/* Action mở rộng cho các task sau cắm vào */}
        {renderActions ? renderActions(plan, view) : null}
      </Card>

      {/* BottomSheet xác nhận đồng ý */}
      <BottomSheet
        open={confirmSheetOpen}
        onClose={() => setConfirmSheetOpen(false)}
        title={DATES_COPY.sheets.confirm.title}
      >
        <View className="gap-space-md">
          <Text variant="body-md" className="text-secondary leading-relaxed">
            {DATES_COPY.sheets.confirm.body}
          </Text>
          <View className="gap-space-sm">
            <Button
              testID="date-confirm-ok"
              variant="primary"
              size="lg"
              fullWidth
              loading={respondMutation.isPending}
              disabled={respondMutation.isPending}
              onPress={() => void handleRespond('confirm')}
            >
              {DATES_COPY.sheets.confirm.confirm}
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={respondMutation.isPending}
              onPress={() => setConfirmSheetOpen(false)}
            >
              {DATES_COPY.sheets.confirm.keep}
            </Button>
          </View>
        </View>
      </BottomSheet>

      {/* BottomSheet xác nhận từ chối */}
      <BottomSheet
        open={declineSheetOpen}
        onClose={() => setDeclineSheetOpen(false)}
        title={DATES_COPY.sheets.decline.title}
      >
        <View className="gap-space-md">
          <Text variant="body-md" className="text-secondary leading-relaxed">
            {DATES_COPY.sheets.decline.body}
          </Text>
          <View className="gap-space-sm">
            <Button
              testID="date-decline-ok"
              variant="danger"
              size="lg"
              fullWidth
              loading={respondMutation.isPending}
              disabled={respondMutation.isPending}
              onPress={() => void handleRespond('decline')}
            >
              {DATES_COPY.sheets.decline.confirm}
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={respondMutation.isPending}
              onPress={() => setDeclineSheetOpen(false)}
            >
              {DATES_COPY.sheets.decline.keep}
            </Button>
          </View>
        </View>
      </BottomSheet>

      {/* BottomSheet xác nhận huỷ */}
      <BottomSheet
        open={cancelSheetOpen}
        onClose={() => setCancelSheetOpen(false)}
        title={DATES_COPY.sheets.cancel.title}
      >
        <View className="gap-space-md">
          <Text variant="body-md" className="text-secondary leading-relaxed">
            {DATES_COPY.sheets.cancel.body}
          </Text>
          <View className="gap-space-sm">
            <Button
              testID="date-cancel-ok"
              variant="danger"
              size="lg"
              fullWidth
              loading={cancelMutation.isPending}
              disabled={cancelMutation.isPending}
              onPress={() => void handleCancel()}
            >
              {DATES_COPY.sheets.cancel.confirm}
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={cancelMutation.isPending}
              onPress={() => setCancelSheetOpen(false)}
            >
              {DATES_COPY.sheets.cancel.keep}
            </Button>
          </View>
        </View>
      </BottomSheet>
    </>
  );
}
