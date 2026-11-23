import { useCallback, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { REFUND_SLA_HOURS, VOUCHER_TTL_DAYS } from '@tamgiao/contracts/constants';
import { Badge, Button, Card, ErrorState, Text } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { InterviewEntryCard } from '../interview/index.js';
import { formatVnd } from '../payment/index.js';
import { KYC_COPY } from './copy.js';
import { VERIFICATION_STATUS_COPY } from './status-copy.js';
import {
  countPassedSteps,
  displayableVoucher,
  formatLocalDate,
  formatLocalDateTime,
  latestPaidPayment,
  refundStateFor,
  stepDisplayStates,
  voucherPartnerNames,
} from './status-model.js';
import { useKycProgress } from './use-kyc.js';
import {
  useMyVouchers,
  usePartners,
  usePaymentHistory,
  useRefreshVerificationStatus,
  useVerificationStatusPushRefresh,
} from './use-verification-status.js';

export function VerificationStatusScreen() {
  const router = useRouter();
  const kyc = useKycProgress();
  const payments = usePaymentHistory();
  const vouchers = useMyVouchers();
  const partners = usePartners();
  useVerificationStatusPushRefresh();
  const refresh = useRefreshVerificationStatus();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      void partners.refetch();
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh, partners]);

  if (kyc.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="title-md" className="font-semibold text-primary">
          {VERIFICATION_STATUS_COPY.loading}
        </Text>
      </View>
    );
  }

  if (kyc.isError) {
    const errorTitle = isApiError(kyc.error)
      ? messageFor(kyc.error).title
      : VERIFICATION_STATUS_COPY.genericError;
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={errorTitle}
          onRetry={() => {
            void kyc.refetch();
          }}
        />
      </View>
    );
  }

  const progress = kyc.data;
  if (!progress) {
    return null;
  }

  const payment = payments.data ? latestPaidPayment(payments.data.items) : null;
  const voucher = vouchers.data ? displayableVoucher(vouchers.data.items) : null;
  const refundState = refundStateFor(progress, payment);
  const stepStates = stepDisplayStates(progress);
  const passedCount = countPassedSteps(progress);
  const statusCopy = VERIFICATION_STATUS_COPY.status[progress.status];

  let voucherPartnerLine: string | null = null;
  if (voucher !== null && partners.data) {
    const names = voucherPartnerNames(voucher, partners.data.items);
    if (names.length > 0) {
      voucherPartnerLine = VERIFICATION_STATUS_COPY.voucher.usableAt(names.join(', '));
    } else if (voucher.partnerId === null) {
      voucherPartnerLine = VERIFICATION_STATUS_COPY.voucher.anyPartner;
    }
  }

  const statusTone =
    progress.status === 'APPROVED'
      ? 'success'
      : progress.status === 'REJECTED'
        ? 'danger'
        : progress.status === 'NEEDS_MORE_INFO'
          ? 'warning'
          : 'primary';

  return (
    <View className="flex-1 bg-surface">
      {/* Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-margin flex-row items-center gap-space-sm">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={VERIFICATION_STATUS_COPY.header.back}
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
            {VERIFICATION_STATUS_COPY.header.title}
          </Text>
        </View>
      </View>

      <ScrollView
        testID="verification-status-scroll"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 60 }}
        className="flex-1 px-margin"
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        <View className="py-space-md gap-space-md max-w-md mx-auto w-full">
          {/* Thẻ trạng thái */}
          <Card testID="status-card" className="bg-surface-container-low gap-space-xs">
            <View className="flex-row items-center gap-space-xs">
              <Badge tone={statusTone}>{statusCopy.badge}</Badge>
            </View>
            <Text variant="headline-sm" className="font-bold text-on-surface">
              {statusCopy.title}
            </Text>
            <Text variant="body-sm" className="text-secondary leading-relaxed">
              {statusCopy.body}
            </Text>

            {/* NEEDS_MORE_INFO */}
            {progress.status === 'NEEDS_MORE_INFO' && progress.moreInfo ? (
              <View className="mt-space-xs p-space-sm rounded-lg bg-surface-container gap-space-xs">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {VERIFICATION_STATUS_COPY.moreInfo.itemsLabel}
                </Text>
                {progress.moreInfo.items.map((item) => (
                  <Text key={item} variant="body-sm" className="text-on-surface">
                    • {KYC_COPY.moreInfo.items[item]}
                  </Text>
                ))}
                {progress.moreInfo.note ? (
                  <View className="mt-1">
                    <Text variant="label-sm" className="font-semibold text-secondary">
                      {VERIFICATION_STATUS_COPY.moreInfo.noteLabel}
                    </Text>
                    <Text variant="body-sm" className="text-on-surface italic">
                      {progress.moreInfo.note}
                    </Text>
                  </View>
                ) : null}
                <View className="mt-space-xs">
                  <Button
                    testID="status-more-info-cta"
                    variant="primary"
                    size="md"
                    onPress={() => router.push('/(verification)/kyc')}
                  >
                    {VERIFICATION_STATUS_COPY.moreInfo.cta}
                  </Button>
                </View>
              </View>
            ) : null}

            {/* REJECTED: Lý do & Hoàn tiền */}
            {progress.status === 'REJECTED' ? (
              <>
                {progress.rejectionReason !== null ? (
                  <View
                    testID="status-rejection-reason"
                    className="mt-space-xs p-space-sm rounded-lg bg-error-container/40 gap-1"
                  >
                    <Text variant="label-sm" className="font-semibold text-error uppercase">
                      {VERIFICATION_STATUS_COPY.rejection.title}
                    </Text>
                    <Text variant="body-sm" className="text-on-surface">
                      {VERIFICATION_STATUS_COPY.rejection.reasons[progress.rejectionReason]}
                    </Text>
                  </View>
                ) : null}

                {refundState.kind !== 'none' ? (
                  <View
                    testID="status-refund"
                    className="mt-space-xs p-space-sm rounded-lg bg-surface-container gap-space-xs"
                  >
                    <Text variant="label-md" className="font-semibold text-on-surface">
                      {VERIFICATION_STATUS_COPY.refund.title}
                    </Text>
                    {refundState.kind === 'not_started' ? (
                      <View className="gap-0.5">
                        <Text variant="body-sm" className="text-secondary">
                          {VERIFICATION_STATUS_COPY.refund.notStarted(REFUND_SLA_HOURS)}
                        </Text>
                        {refundState.deadline ? (
                          <Text variant="body-sm" className="text-secondary">
                            {VERIFICATION_STATUS_COPY.refund.deadline(
                              formatLocalDateTime(refundState.deadline),
                            )}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    {refundState.kind === 'pending' ? (
                      <View className="gap-1 items-start">
                        <Badge tone="warning">{VERIFICATION_STATUS_COPY.refund.pending}</Badge>
                        {refundState.deadline ? (
                          <Text variant="body-sm" className="text-secondary">
                            {VERIFICATION_STATUS_COPY.refund.deadline(
                              formatLocalDateTime(refundState.deadline),
                            )}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    {refundState.kind === 'refunded' ? (
                      <View className="gap-1 items-start">
                        <Badge tone="success">
                          {VERIFICATION_STATUS_COPY.refund.refunded(formatVnd(refundState.amountVnd))}
                        </Badge>
                        {refundState.refundedAt ? (
                          <Text variant="body-sm" className="text-secondary">
                            {VERIFICATION_STATUS_COPY.refund.refundedAt(
                              formatLocalDateTime(refundState.refundedAt),
                            )}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}

            {/* APPROVED CTA */}
            {progress.status === 'APPROVED' ? (
              <View className="mt-space-xs">
                <Button
                  testID="status-approved-cta"
                  variant="primary"
                  size="lg"
                  fullWidth
                  onPress={() => router.replace('/')}
                >
                  {VERIFICATION_STATUS_COPY.approved.cta}
                </Button>
              </View>
            ) : null}

            {/* NOT_SUBMITTED / DRAFT CTA */}
            {progress.status === 'NOT_SUBMITTED' || progress.status === 'DRAFT' ? (
              <View className="mt-space-xs">
                <Button
                  testID="status-continue-cta"
                  variant="primary"
                  size="lg"
                  fullWidth
                  onPress={() => router.replace('/(verification)/start')}
                >
                  {VERIFICATION_STATUS_COPY.notSubmitted.cta}
                </Button>
              </View>
            ) : null}
          </Card>

          {/* Thẻ phí (khi latestPaidPayment khác null và status khác REJECTED) */}
          {payment !== null && progress.status !== 'REJECTED' ? (
            <Card className="bg-surface-container-low flex-row items-center gap-space-sm">
              <View className="w-8 h-8 rounded-full bg-secondary-container items-center justify-center">
                <Text variant="label-md" className="font-bold text-on-secondary-container">
                  ✓
                </Text>
              </View>
              <Text variant="body-sm" className="font-semibold text-on-surface flex-1">
                {VERIFICATION_STATUS_COPY.payment.recorded(formatVnd(payment.amountVnd))}
              </Text>
            </Card>
          ) : null}

          {/* Thẻ voucher */}
          {voucher !== null ? (
            <Card
              testID="status-voucher"
              className="border border-dashed border-tertiary bg-tertiary-fixed/30 gap-space-xs"
            >
              <View className="flex-row items-center justify-between gap-2">
                <Text variant="title-md" className="font-bold text-on-tertiary-fixed flex-1">
                  {VERIFICATION_STATUS_COPY.voucher.title(formatVnd(voucher.valueVnd))}
                </Text>
                <Badge tone={voucher.status === 'ACTIVE' ? 'success' : 'warning'}>
                  {VERIFICATION_STATUS_COPY.voucher.status[voucher.status]}
                </Badge>
              </View>
              {voucherPartnerLine ? (
                <Text variant="body-sm" className="text-on-tertiary-fixed-variant">
                  {voucherPartnerLine}
                </Text>
              ) : null}
              <Text variant="body-sm" className="text-on-tertiary-fixed-variant">
                {voucher.expiresAt !== null
                  ? VERIFICATION_STATUS_COPY.voucher.expiresAt(formatLocalDate(voucher.expiresAt))
                  : VERIFICATION_STATUS_COPY.voucher.ttlPending(VOUCHER_TTL_DAYS)}
              </Text>
              {voucher.status === 'RESERVED' && voucher.expiresAt === null ? (
                <Text variant="body-sm" className="text-on-tertiary-fixed-variant italic">
                  {VERIFICATION_STATUS_COPY.voucher.reservedHint}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {/* Lối vào đặt lịch phỏng vấn sơ bộ (FE-S3-03) — BE chỉ cho đặt khi hồ sơ đã nộp, chưa quyết định */}
          {progress.status === 'SUBMITTED' || progress.status === 'UNDER_REVIEW' ? (
            <InterviewEntryCard />
          ) : null}

          {/* Thẻ các bước */}
          <Card testID="status-steps" className="gap-space-md">
            <View className="flex-row items-center justify-between">
              <Text variant="title-md" className="font-bold text-on-surface">
                {VERIFICATION_STATUS_COPY.steps.title}
              </Text>
              <View className="px-2 py-0.5 rounded-full bg-surface-container-high">
                <Text variant="label-sm" className="font-semibold text-on-surface">
                  {VERIFICATION_STATUS_COPY.steps.progress(passedCount, progress.steps.length)}
                </Text>
              </View>
            </View>

            <View className="gap-space-md">
              {stepStates.map(({ step, state }) => {
                const isPassed = state === 'passed';
                const isFailed = state === 'failed';
                const isCurrent = state === 'current';

                const iconSymbol = isPassed ? '✓' : isFailed ? '✕' : '•';
                const iconBgClass = isPassed
                  ? 'bg-secondary-container'
                  : isFailed
                    ? 'bg-error-container'
                    : isCurrent
                      ? 'bg-tertiary-fixed'
                      : 'bg-surface-container-high';
                const iconTextClass = isPassed
                  ? 'text-on-secondary-container'
                  : isFailed
                    ? 'text-error'
                    : isCurrent
                      ? 'text-on-tertiary-fixed'
                      : 'text-secondary';

                const stateTone = isPassed
                  ? 'text-primary'
                  : isFailed
                    ? 'text-error'
                    : isCurrent
                      ? 'text-tertiary'
                      : 'text-secondary';

                return (
                  <View
                    key={step}
                    testID={`status-step-${step}`}
                    className="flex-row items-start gap-space-sm"
                  >
                    <View
                      className={`w-6 h-6 rounded-full items-center justify-center mt-0.5 ${iconBgClass}`}
                    >
                      <Text variant="label-sm" className={`font-bold ${iconTextClass}`}>
                        {iconSymbol}
                      </Text>
                    </View>
                    <View className="flex-1 gap-0.5">
                      <View className="flex-row items-center justify-between gap-space-xs">
                        <Text variant="label-md" className="font-semibold text-on-surface flex-1">
                          {VERIFICATION_STATUS_COPY.steps.labels[step]}
                        </Text>
                        <Text
                          testID={`status-step-state-${step}`}
                          variant="label-sm"
                          className={`font-semibold ${stateTone}`}
                        >
                          {VERIFICATION_STATUS_COPY.steps.states[state]}
                        </Text>
                      </View>
                      <Text variant="body-sm" className="text-secondary leading-relaxed">
                        {VERIFICATION_STATUS_COPY.steps.descriptions[step]}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>

          {/* Thẻ bảo mật dữ liệu cá nhân */}
          <Card className="bg-surface-container-high/60 gap-space-xs">
            <Text variant="title-md" className="font-semibold text-on-surface">
              {VERIFICATION_STATUS_COPY.privacy.title}
            </Text>
            <Text variant="body-sm" className="text-secondary leading-relaxed">
              {VERIFICATION_STATUS_COPY.privacy.body}
            </Text>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}
