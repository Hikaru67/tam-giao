import { useMemo, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { DATE_RESPONSE_TTL_HOURS, DATING_DAYS } from '@tamgiao/contracts/constants';
import { Button, Card, EmptyState, ErrorState, Text, useToast } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from 'react-native';
import { DATES_COPY } from './copy.js';
import { buildDateOptions, formatLocalDate, formatLocalTime, type DateTimeSlotId } from './date-options.js';
import { usePartners } from '../kyc/use-verification-status.js';
import { useProposeDate } from './use-dates.js';

export interface DateProposalFormProps {
  readonly now: Date;
  readonly matchExpiresAt: string | null;
  readonly counterpartName?: string | undefined;
}

export function DateProposalForm({ now, matchExpiresAt, counterpartName }: DateProposalFormProps) {
  const { showToast } = useToast();
  const partnersQuery = usePartners();
  const proposeMutation = useProposeDate();

  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<DateTimeSlotId | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [staffBookingRequested, setStaffBookingRequested] = useState(false);

  const until = useMemo(() => {
    return matchExpiresAt ? new Date(matchExpiresAt) : new Date(now.getTime() + DATING_DAYS * 86_400_000);
  }, [matchExpiresAt, now]);

  const days = useMemo(() => buildDateOptions(now, until), [now, until]);

  const activeDay = useMemo(() => {
    return days.find((d) => d.dayKey === selectedDayKey) ?? null;
  }, [days, selectedDayKey]);

  const activeSlot = useMemo(() => {
    if (!activeDay || !selectedSlotId) return null;
    return activeDay.slots.find((s) => s.id === selectedSlotId && !s.disabled) ?? null;
  }, [activeDay, selectedSlotId]);

  const partners = partnersQuery.data?.items ?? [];

  const canSubmit =
    selectedDayKey !== null &&
    selectedSlotId !== null &&
    selectedPartnerId !== null &&
    activeSlot !== null &&
    !proposeMutation.isPending;

  const handleSubmit = async () => {
    if (!canSubmit || !activeSlot || !selectedPartnerId) return;

    try {
      await proposeMutation.mutateAsync({
        partnerId: selectedPartnerId,
        startsAt: activeSlot.startsAt.toISOString(),
        endsAt: activeSlot.endsAt.toISOString(),
        staffBookingRequested,
      });
      showToast(DATES_COPY.toasts.proposed, 'success');
    } catch (err) {
      showToast(messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title, 'danger');
    }
  };

  return (
    <View className="gap-space-md">
      {/* 1. Chọn thời gian */}
      <Card className="gap-space-sm">
        <Text variant="title-md" className="font-bold text-on-surface">
          {DATES_COPY.proposal.stepTimeTitle}
        </Text>

        {days.length === 0 ? (
          <Text variant="body-md" className="text-secondary">
            {DATES_COPY.proposal.noDaysAvailable}
          </Text>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {days.map((day) => {
                const isSelected = selectedDayKey === day.dayKey;
                return (
                  <Pressable
                    key={day.dayKey}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    testID={`date-day-${day.dayKey}`}
                    onPress={() => {
                      setSelectedDayKey(day.dayKey);
                      const targetDay = days.find((d) => d.dayKey === day.dayKey);
                      const slotStillValid = targetDay?.slots.some(
                        (s) => s.id === selectedSlotId && !s.disabled,
                      );
                      if (!slotStillValid) {
                        setSelectedSlotId(null);
                      }
                    }}
                    className={`px-space-md py-space-xs rounded-xl border ${
                      isSelected
                        ? 'bg-primary-fixed border-primary'
                        : 'bg-surface-container-low border-surface-container-high'
                    }`}
                  >
                    <Text
                      variant="label-md"
                      className={isSelected ? 'text-on-primary-fixed font-semibold' : 'text-on-surface'}
                    >
                      {formatLocalDate(day.date)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {activeDay ? (
              <View className="gap-space-xs mt-space-xs">
                <Text variant="body-sm" className="text-secondary font-medium">
                  {DATES_COPY.proposal.stepTimeSubtitle}
                </Text>
                <View className="flex-row flex-wrap gap-space-xs">
                  {activeDay.slots.map((slot) => {
                    const isSelected = selectedSlotId === slot.id;
                    const slotText = DATES_COPY.proposal.slotLabel(
                      formatLocalTime(slot.startsAt),
                      formatLocalTime(slot.endsAt),
                      DATES_COPY.proposal.slotHints[slot.id],
                    );

                    return (
                      <Pressable
                        key={slot.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected, disabled: slot.disabled }}
                        testID={`date-slot-${slot.id}`}
                        disabled={slot.disabled}
                        onPress={() => {
                          if (!slot.disabled) {
                            setSelectedSlotId(slot.id);
                          }
                        }}
                        className={`px-space-md py-space-xs rounded-lg border ${
                          slot.disabled
                            ? 'opacity-40 bg-surface-container-low border-surface-container-high'
                            : isSelected
                              ? 'bg-primary-fixed border-primary'
                              : 'bg-surface-container-low border-surface-container-high'
                        }`}
                      >
                        <Text
                          variant="label-md"
                          className={
                            isSelected && !slot.disabled
                              ? 'text-on-primary-fixed font-semibold'
                              : 'text-on-surface'
                          }
                        >
                          {slotText}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </>
        )}
      </Card>

      {/* 2. Chọn điểm hẹn đối tác an toàn */}
      <Card className="gap-space-sm">
        <Text variant="title-md" className="font-bold text-on-surface">
          {DATES_COPY.proposal.stepPartnerTitle}
        </Text>

        {partnersQuery.isLoading ? (
          <View className="py-space-md items-center justify-center">
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}

        {partnersQuery.isError && partnersQuery.data === undefined ? (
          <ErrorState
            title={DATES_COPY.emptyPartners.title}
            action={DATES_COPY.emptyPartners.retry}
            onRetry={() => void partnersQuery.refetch()}
          />
        ) : null}

        {partnersQuery.data !== undefined && partners.length === 0 ? (
          <EmptyState
            title={DATES_COPY.emptyPartners.title}
            description={DATES_COPY.emptyPartners.description}
            action={
              <Button variant="secondary" size="md" onPress={() => void partnersQuery.refetch()}>
                {DATES_COPY.emptyPartners.retry}
              </Button>
            }
          />
        ) : null}

        {partnersQuery.data !== undefined && partners.length > 0 ? (
          <View className="gap-space-xs">
            {partners.map((partner) => {
              const isSelected = selectedPartnerId === partner.id;
              return (
                <Pressable
                  key={partner.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  testID={`date-partner-${partner.id}`}
                  onPress={() => setSelectedPartnerId(partner.id)}
                  className={`p-space-sm rounded-xl border ${
                    isSelected
                      ? 'bg-primary-fixed/20 border-primary'
                      : 'bg-surface-container-lowest border-surface-container-high'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <Text variant="title-md" className="font-semibold text-on-surface flex-1">
                      {partner.name}
                    </Text>
                    <View
                      className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
                        isSelected ? 'border-primary' : 'border-secondary'
                      }`}
                    >
                      {isSelected ? <View className="w-2.5 h-2.5 rounded-full bg-primary" /> : null}
                    </View>
                  </View>
                  <Text variant="body-sm" className="text-secondary mt-1">
                    {partner.address}
                  </Text>
                  {partner.tags.length > 0 ? (
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
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Card>

      {/* 3. Chuyên viên xác nhận đặt bàn */}
      <Card className="gap-space-xs">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-space-sm">
            <Text variant="title-md" className="font-semibold text-on-surface">
              {DATES_COPY.proposal.staffBooking.title}
            </Text>
            <Text variant="body-sm" className="text-secondary mt-0.5">
              {DATES_COPY.proposal.staffBooking.description}
            </Text>
          </View>
          <Switch
            testID="date-staff-booking"
            value={staffBookingRequested}
            onValueChange={setStaffBookingRequested}
            trackColor={{
              false: colors['surface-container-high'],
              true: colors.primary,
            }}
          />
        </View>
      </Card>

      {/* 4. Ghi chú voucher trung tính */}
      <Card className="bg-surface-container-low border border-surface-container-high">
        <Text variant="body-sm" className="text-secondary leading-relaxed">
          {DATES_COPY.proposal.voucherNote}
        </Text>
      </Card>

      {/* 5. Quy tắc ứng xử an toàn */}
      <Card className="bg-surface-container-low border border-surface-container-high gap-space-xs">
        <Text variant="label-md" className="font-bold text-on-surface">
          {DATES_COPY.proposal.safetyGuidelines.title}
        </Text>
        <Text variant="body-sm" className="text-secondary leading-relaxed">
          {DATES_COPY.proposal.safetyGuidelines.body}
        </Text>
      </Card>

      {/* Nút gửi đề xuất */}
      <View className="gap-space-xs mt-space-xs">
        <Button
          testID="date-propose"
          variant="primary"
          size="lg"
          fullWidth
          loading={proposeMutation.isPending}
          disabled={!canSubmit}
          onPress={() => void handleSubmit()}
        >
          {counterpartName ? DATES_COPY.proposal.submit(counterpartName) : DATES_COPY.proposal.submitGeneric}
        </Button>
        <Text variant="body-sm" className="text-secondary text-center">
          {DATES_COPY.proposal.submitHint(DATE_RESPONSE_TTL_HOURS)}
        </Text>
      </View>
    </View>
  );
}
