import { useMemo, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { INTERVIEW_CHANGE_CUTOFF_HOURS, INTERVIEW_DURATION_MINUTES } from '@tamgiao/contracts/constants';
import { useCountdown } from '@tamgiao/ui-core';
import { Badge, BottomSheet, Button, Card, EmptyState, ErrorState, Text, useToast } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { type Clock, systemClock } from './clock.js';
import { INTERVIEW_COPY } from './copy.js';
import {
  changeDeadlineOf,
  formatLocalDate,
  formatLocalTime,
  groupSlotsByLocalDay,
  isChangeLocked,
  type InterviewBooking,
} from './interview-time.js';
import {
  isSlotTakenError,
  useBookInterview,
  useCancelInterview,
  useInterviewSlots,
  useMyInterview,
  useRescheduleInterview,
} from './use-interview.js';

function weekdayLabel(d: Date): string {
  const dayIndex = d.getDay();
  const label = INTERVIEW_COPY.picker.weekdays[dayIndex];
  if (label === undefined) {
    throw new Error('invalid weekday');
  }
  return label;
}

interface BookedInterviewCardProps {
  booking: InterviewBooking;
  clock: Clock;
  cardError: { title: string; action?: string } | null;
  onStartReschedule: () => void;
  onClearCardError: () => void;
}

function BookedInterviewCard({
  booking,
  clock,
  cardError,
  onStartReschedule,
  onClearCardError,
}: BookedInterviewCardProps) {
  const { showToast } = useToast();
  const cancelMutation = useCancelInterview();
  const [cancelSheetOpen, setCancelSheetOpen] = useState(false);
  const [localCancelError, setLocalCancelError] = useState<{
    title: string;
    action?: string;
  } | null>(null);

  const deadline = useMemo(() => changeDeadlineOf(booking.startsAt), [booking.startsAt]);
  const countdown = useCountdown(deadline, { now: () => clock.now() });
  const locked = isChangeLocked(booking, clock.now()) || countdown.expired;

  const displayError = localCancelError ?? cardError;

  const handleConfirmCancel = async () => {
    try {
      await cancelMutation.mutateAsync();
      setCancelSheetOpen(false);
      setLocalCancelError(null);
      onClearCardError();
      showToast(INTERVIEW_COPY.toast.cancelled, 'success');
    } catch (err) {
      setCancelSheetOpen(false);
      if (isApiError(err)) {
        setLocalCancelError(messageFor(err));
      } else {
        setLocalCancelError({ title: INTERVIEW_COPY.genericError });
      }
    }
  };

  return (
    <>
      <Card className="gap-space-sm">
        <View className="flex-row items-center justify-between">
          <Text variant="title-md" className="font-bold text-on-surface">
            {INTERVIEW_COPY.booking.title}
          </Text>
          <Badge tone="success">{INTERVIEW_COPY.booking.badge}</Badge>
        </View>

        <Text testID="interview-booking" variant="title-md" className="font-semibold text-primary">
          {INTERVIEW_COPY.booking.when(
            formatLocalDate(booking.startsAt),
            formatLocalTime(booking.startsAt),
            formatLocalTime(booking.endsAt),
          )}
        </Text>

        {locked ? (
          <View accessibilityRole="alert" className="p-space-sm rounded-lg bg-surface-container gap-1">
            <Text testID="interview-locked-hint" variant="body-sm" className="text-secondary">
              {INTERVIEW_COPY.booking.lockedHint(INTERVIEW_CHANGE_CUTOFF_HOURS)}
            </Text>
          </View>
        ) : (
          <Text testID="interview-change-hint" variant="body-sm" className="text-secondary leading-relaxed">
            {INTERVIEW_COPY.booking.changeHint(
              INTERVIEW_CHANGE_CUTOFF_HOURS,
              formatLocalTime(deadline),
              formatLocalDate(deadline),
            )}
          </Text>
        )}

        {displayError ? (
          <View
            accessibilityRole="alert"
            testID="interview-error"
            className="p-space-sm rounded-lg bg-error-container/40 border border-error/30 gap-1"
          >
            <Text variant="label-md" className="font-semibold text-error text-center">
              {displayError.title}
            </Text>
            {displayError.action ? (
              <Text variant="body-sm" className="text-secondary text-center">
                {displayError.action}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View className="flex-row gap-space-sm mt-space-xs">
          <Button
            testID="interview-reschedule"
            variant="secondary"
            size="md"
            disabled={locked}
            onPress={onStartReschedule}
          >
            {INTERVIEW_COPY.cta.reschedule}
          </Button>
          <Button
            testID="interview-cancel"
            variant="ghost"
            size="md"
            disabled={locked}
            onPress={() => {
              if (!locked) {
                setCancelSheetOpen(true);
              }
            }}
          >
            {INTERVIEW_COPY.cta.cancel}
          </Button>
        </View>
      </Card>

      <BottomSheet
        open={cancelSheetOpen}
        onClose={() => setCancelSheetOpen(false)}
        title={INTERVIEW_COPY.cancelSheet.title}
      >
        <View className="gap-space-md">
          <Text variant="body-md" className="text-secondary leading-relaxed">
            {INTERVIEW_COPY.cancelSheet.body}
          </Text>
          <View className="gap-space-sm">
            <Button
              testID="interview-cancel-confirm"
              variant="danger"
              size="lg"
              fullWidth
              loading={cancelMutation.isPending}
              disabled={cancelMutation.isPending}
              onPress={() => void handleConfirmCancel()}
            >
              {INTERVIEW_COPY.cancelSheet.confirm}
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={cancelMutation.isPending}
              onPress={() => setCancelSheetOpen(false)}
            >
              {INTERVIEW_COPY.cancelSheet.keep}
            </Button>
          </View>
        </View>
      </BottomSheet>
    </>
  );
}

interface SlotPickerProps {
  isRescheduling: boolean;
  currentBookingSlotId: string | null;
  onCancelReschedule: () => void;
  onRescheduleSuccess: () => void;
  onRescheduleTooLate: (err: unknown) => void;
}

function SlotPicker({
  isRescheduling,
  currentBookingSlotId,
  onCancelReschedule,
  onRescheduleSuccess,
  onRescheduleTooLate,
}: SlotPickerProps) {
  const { showToast } = useToast();
  const slotsQuery = useInterviewSlots();
  const book = useBookInterview();
  const reschedule = useRescheduleInterview();

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<{
    title: string;
    action?: string;
  } | null>(null);

  const isPending = book.isPending || reschedule.isPending;

  const items = slotsQuery.data?.items;
  const days = useMemo(() => {
    if (items === undefined) return [];
    // Đổi lịch: không cho chọn lại chính slot đang giữ.
    const selectable =
      isRescheduling && currentBookingSlotId !== null
        ? items.filter((s) => s.id !== currentBookingSlotId)
        : items;
    return groupSlotsByLocalDay(selectable);
  }, [items, isRescheduling, currentBookingSlotId]);

  const handleSubmit = async () => {
    if (!selectedSlotId) return;
    setPickerError(null);

    if (isRescheduling) {
      try {
        await reschedule.mutateAsync(selectedSlotId);
        showToast(INTERVIEW_COPY.toast.rescheduled, 'success');
        setSelectedSlotId(null);
        onRescheduleSuccess();
      } catch (err) {
        if (isSlotTakenError(err)) {
          setSelectedSlotId(null);
          setPickerError({ title: INTERVIEW_COPY.toast.slotTaken });
        } else if (isApiError(err)) {
          if (err.code === 'CANCEL_TOO_LATE') {
            onRescheduleTooLate(err);
          } else {
            setPickerError(messageFor(err));
          }
        } else {
          setPickerError({ title: INTERVIEW_COPY.genericError });
        }
      }
    } else {
      try {
        await book.mutateAsync(selectedSlotId);
        showToast(INTERVIEW_COPY.toast.booked, 'success');
        setSelectedSlotId(null);
      } catch (err) {
        if (isSlotTakenError(err)) {
          setSelectedSlotId(null);
          setPickerError({ title: INTERVIEW_COPY.toast.slotTaken });
        } else if (isApiError(err)) {
          setPickerError(messageFor(err));
        } else {
          setPickerError({ title: INTERVIEW_COPY.genericError });
        }
      }
    }
  };

  return (
    <View className="flex-1">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 160 }} className="flex-1 px-margin">
        <View className="py-space-md gap-space-md max-w-md mx-auto w-full">
          {/* Card giới thiệu */}
          <Card className="gap-space-xs">
            <Text variant="title-md" className="font-bold text-on-surface">
              {INTERVIEW_COPY.intro.title(INTERVIEW_DURATION_MINUTES)}
            </Text>
            <Text variant="body-md" className="text-secondary leading-relaxed">
              {INTERVIEW_COPY.intro.body}
            </Text>
          </Card>

          <View className="gap-space-xs">
            <Text variant="headline-sm" className="font-bold text-on-surface">
              {isRescheduling ? INTERVIEW_COPY.picker.rescheduleTitle : INTERVIEW_COPY.picker.title}
            </Text>
            <Text variant="body-sm" className="text-secondary">
              {INTERVIEW_COPY.picker.timezoneHint}
            </Text>
          </View>

          {/* Slots content */}
          {slotsQuery.isLoading ? (
            <View className="items-center justify-center py-space-xl gap-space-sm">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : null}

          {slotsQuery.isError ? (
            <ErrorState
              title={
                isApiError(slotsQuery.error)
                  ? messageFor(slotsQuery.error).title
                  : INTERVIEW_COPY.genericError
              }
              onRetry={() => {
                void slotsQuery.refetch();
              }}
            />
          ) : null}

          {!slotsQuery.isLoading && !slotsQuery.isError && days.length === 0 ? (
            <EmptyState
              title={INTERVIEW_COPY.picker.empty.title}
              description={INTERVIEW_COPY.picker.empty.description}
              action={
                <Button
                  variant="secondary"
                  size="md"
                  onPress={() => {
                    void slotsQuery.refetch();
                  }}
                >
                  {INTERVIEW_COPY.picker.refresh}
                </Button>
              }
            />
          ) : null}

          {!slotsQuery.isLoading && !slotsQuery.isError && days.length > 0 ? (
            <View className="gap-space-md">
              {days.map((day) => (
                <View key={day.dayKey} className="gap-space-xs">
                  <Text variant="title-md" className="font-semibold text-on-surface">
                    {INTERVIEW_COPY.picker.dayLabel(weekdayLabel(day.date), formatLocalDate(day.date))}
                  </Text>
                  <View className="flex-row flex-wrap gap-space-xs">
                    {day.slots.map((slot) => {
                      const isSelected = selectedSlotId === slot.id;
                      return (
                        <Pressable
                          key={slot.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          testID={`interview-slot-${slot.id}`}
                          onPress={() => {
                            setPickerError(null);
                            setSelectedSlotId(slot.id);
                          }}
                          className={`px-space-md py-space-xs rounded-lg border ${
                            isSelected
                              ? 'bg-primary-fixed border-primary'
                              : 'bg-surface-container-low border-surface-container-high'
                          }`}
                        >
                          <Text
                            variant="label-md"
                            className={isSelected ? 'text-on-primary-fixed font-semibold' : 'text-on-surface'}
                          >
                            {INTERVIEW_COPY.picker.slotLabel(
                              formatLocalTime(slot.startsAt),
                              formatLocalTime(slot.endsAt),
                            )}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* CTA đáy cố định (như payment) */}
      {!slotsQuery.isLoading && !slotsQuery.isError ? (
        <View className="absolute bottom-0 left-0 right-0 p-margin bg-surface/95 border-t border-surface-container-high/60 flex-col gap-2 shadow-lg">
          {pickerError ? (
            <View
              accessibilityRole="alert"
              testID="interview-error"
              className="p-space-sm rounded-lg bg-error-container/40 border border-error/30 gap-1"
            >
              <Text variant="label-md" className="font-semibold text-error text-center">
                {pickerError.title}
              </Text>
              {pickerError.action ? (
                <Text variant="body-sm" className="text-secondary text-center">
                  {pickerError.action}
                </Text>
              ) : null}
            </View>
          ) : null}

          <Button
            testID="interview-submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={isPending}
            disabled={!selectedSlotId || isPending}
            onPress={() => void handleSubmit()}
          >
            {isRescheduling ? INTERVIEW_COPY.cta.confirmReschedule : INTERVIEW_COPY.cta.book}
          </Button>

          {isRescheduling ? (
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={isPending}
              onPress={() => {
                setPickerError(null);
                setSelectedSlotId(null);
                onCancelReschedule();
              }}
            >
              {INTERVIEW_COPY.cta.cancelReschedule}
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function InterviewScreen({ clock = systemClock }: { clock?: Clock }) {
  const router = useRouter();
  const interviewQuery = useMyInterview();

  const [isRescheduling, setIsRescheduling] = useState(false);
  const [cardError, setCardError] = useState<{
    title: string;
    action?: string;
  } | null>(null);

  if (interviewQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="title-md" className="font-semibold text-primary">
          {INTERVIEW_COPY.loading}
        </Text>
      </View>
    );
  }

  if (interviewQuery.isError) {
    const errorTitle = isApiError(interviewQuery.error)
      ? messageFor(interviewQuery.error).title
      : INTERVIEW_COPY.genericError;
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={errorTitle}
          onRetry={() => {
            void interviewQuery.refetch();
          }}
        />
      </View>
    );
  }

  const booking = interviewQuery.data?.booking ?? null;

  return (
    <View className="flex-1 bg-surface">
      {/* Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-margin flex-row items-center gap-space-sm">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={INTERVIEW_COPY.header.back}
            onPress={() => {
              if (router.canGoBack?.()) {
                router.back();
              }
            }}
            className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
          >
            <Text variant="title-md" className="text-primary font-bold">
              ←
            </Text>
          </Pressable>
          <Text variant="title-md" numberOfLines={1} className="font-semibold text-on-surface flex-1">
            {INTERVIEW_COPY.header.title}
          </Text>
        </View>
      </View>

      {booking !== null && !isRescheduling ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }} className="flex-1 px-margin">
          <View className="py-space-md gap-space-md max-w-md mx-auto w-full">
            {/* Card giới thiệu */}
            <Card className="gap-space-xs">
              <Text variant="title-md" className="font-bold text-on-surface">
                {INTERVIEW_COPY.intro.title(INTERVIEW_DURATION_MINUTES)}
              </Text>
              <Text variant="body-md" className="text-secondary leading-relaxed">
                {INTERVIEW_COPY.intro.body}
              </Text>
            </Card>

            <BookedInterviewCard
              booking={booking}
              clock={clock}
              cardError={cardError}
              onStartReschedule={() => {
                setCardError(null);
                setIsRescheduling(true);
              }}
              onClearCardError={() => setCardError(null)}
            />
          </View>
        </ScrollView>
      ) : (
        <SlotPicker
          isRescheduling={isRescheduling}
          currentBookingSlotId={booking?.slotId ?? null}
          onCancelReschedule={() => {
            setIsRescheduling(false);
          }}
          onRescheduleSuccess={() => {
            setIsRescheduling(false);
            setCardError(null);
          }}
          onRescheduleTooLate={(err) => {
            setIsRescheduling(false);
            setCardError(isApiError(err) ? messageFor(err) : { title: INTERVIEW_COPY.genericError });
          }}
        />
      )}
    </View>
  );
}
