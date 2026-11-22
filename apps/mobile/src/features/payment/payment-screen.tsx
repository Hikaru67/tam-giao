import { useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { DEPOSIT_VND, REFUND_SLA_HOURS, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { Badge, Button, Card, ErrorState, Stepper, Text } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { openCheckout } from './checkout-browser.js';
import { PAYMENT_COPY } from './copy.js';
import { DevFakePaymentPanel } from './dev-fake-payment-panel.js';
import { formatVnd } from './format.js';
import { useCreateVerificationCheckout, usePaymentStatus } from './use-verification-payment.js';

export function PaymentScreen() {
  const router = useRouter();
  const { query, latest, phase, restartPolling } = usePaymentStatus();
  const checkout = useCreateVerificationCheckout();

  const [submitError, setSubmitError] = useState<{ title: string; action?: string } | null>(null);

  if (query.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="title-md" className="font-semibold text-primary">
          {PAYMENT_COPY.loading}
        </Text>
      </View>
    );
  }

  if (query.isError) {
    const errorTitle = isApiError(query.error) ? messageFor(query.error).title : PAYMENT_COPY.genericError;
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={errorTitle}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </View>
    );
  }

  const handleCtaPress = async () => {
    setSubmitError(null);
    try {
      const session = await checkout.mutateAsync();
      restartPolling();
      await openCheckout(session.checkoutUrl);
      restartPolling();
    } catch (err) {
      if (isApiError(err)) {
        if (err.code !== 'PAYMENT_ALREADY_EXISTS') {
          setSubmitError(messageFor(err));
        }
      } else {
        setSubmitError({ title: PAYMENT_COPY.genericError });
      }
    }
  };

  const pendingOrderId = latest?.status === 'PENDING' ? latest.orderId : null;

  let ctaLabel: string;
  if (phase === 'failed') {
    ctaLabel = PAYMENT_COPY.cta.retry;
  } else if (
    (phase === 'polling' || phase === 'timeout') &&
    latest?.status === 'PENDING' &&
    latest.checkoutUrl
  ) {
    ctaLabel = PAYMENT_COPY.cta.resume;
  } else {
    ctaLabel = PAYMENT_COPY.cta.pay(formatVnd(DEPOSIT_VND));
  }

  return (
    <View className="flex-1 bg-surface">
      {/* Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-margin flex-row items-center gap-space-sm">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={PAYMENT_COPY.header.back}
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
            {PAYMENT_COPY.header.title}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 140 }} className="flex-1 px-margin">
        <View className="py-space-md gap-space-md max-w-md mx-auto w-full">
          {/* Progress: Stepper Bước 3/3 */}
          <View className="flex-col gap-2 py-space-xs">
            <View className="flex-row items-center gap-space-xs">
              <View className="px-2 py-0.5 rounded-full bg-primary-fixed">
                <Text
                  variant="label-sm"
                  className="text-on-primary-fixed font-semibold uppercase tracking-wider"
                >
                  {PAYMENT_COPY.progress.stepBadge}
                </Text>
              </View>
              <Text variant="title-md" className="font-semibold text-on-surface">
                {PAYMENT_COPY.progress.steps.verification}
              </Text>
            </View>

            <Stepper
              steps={[
                { label: PAYMENT_COPY.progress.steps.profile, state: 'done' },
                { label: PAYMENT_COPY.progress.steps.preferences, state: 'done' },
                { label: PAYMENT_COPY.progress.steps.verification, state: 'current' },
              ]}
            />
          </View>

          {/* Thẻ phí */}
          <Card className="gap-space-xs">
            <Text variant="label-sm" className="text-secondary uppercase font-semibold">
              {PAYMENT_COPY.fee.label}
            </Text>
            <Text variant="headline-lg-mobile" className="font-bold text-primary">
              {formatVnd(DEPOSIT_VND)}
            </Text>
            <Text variant="body-sm" className="text-secondary mt-1">
              {PAYMENT_COPY.fee.description}
            </Text>
          </Card>

          {/* Thẻ voucher hẹn hò */}
          <Card className="border border-dashed border-tertiary bg-tertiary-fixed/30 gap-space-xs">
            <Text variant="title-md" className="font-bold text-on-tertiary-fixed">
              {PAYMENT_COPY.voucher.title(formatVnd(VOUCHER_VND))}
            </Text>
            <Text variant="body-sm" className="text-on-tertiary-fixed-variant leading-relaxed">
              {PAYMENT_COPY.voucher.body}
            </Text>
          </Card>

          {/* Thẻ cam kết hoàn tiền */}
          <Card className="gap-space-xs bg-surface-container-low">
            <Text variant="title-md" className="font-bold text-on-surface">
              {PAYMENT_COPY.refund.title}
            </Text>
            <Text variant="body-sm" className="text-secondary leading-relaxed">
              {PAYMENT_COPY.refund.body(REFUND_SLA_HOURS, formatVnd(DEPOSIT_VND))}
            </Text>
          </Card>

          {/* Khối trạng thái theo phase */}
          {phase === 'polling' ? (
            <Card
              testID="payment-status"
              className="bg-surface-container-low items-center justify-center p-space-md gap-space-xs"
            >
              <ActivityIndicator size="small" color={colors.primary} />
              <Text variant="label-md" className="font-semibold text-primary text-center">
                {PAYMENT_COPY.status.polling}
              </Text>
              <Text variant="body-sm" className="text-secondary text-center">
                {PAYMENT_COPY.status.pollingHint}
              </Text>
            </Card>
          ) : null}

          {phase === 'succeeded' ? (
            <Card
              testID="payment-status"
              className="bg-surface-container-low items-center p-space-md gap-space-sm"
            >
              <Badge tone={latest?.status === 'SUCCEEDED' ? 'success' : 'neutral'}>
                {latest?.status === 'REFUND_PENDING'
                  ? PAYMENT_COPY.status.refundPending
                  : latest?.status === 'REFUNDED'
                    ? PAYMENT_COPY.status.refunded
                    : PAYMENT_COPY.status.succeeded}
              </Badge>
              {latest?.status === 'SUCCEEDED' ? (
                <Text variant="body-sm" className="text-secondary text-center">
                  {PAYMENT_COPY.status.nextStep}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {phase === 'failed' ? (
            <Card
              testID="payment-status"
              className="bg-surface-container-low items-center p-space-md gap-space-xs"
            >
              <Badge tone="danger">{PAYMENT_COPY.status.failed}</Badge>
            </Card>
          ) : null}

          {phase === 'timeout' ? (
            <Card
              testID="payment-status"
              className="bg-surface-container-low items-center p-space-md gap-space-sm"
            >
              <Text variant="body-sm" className="text-secondary text-center">
                {PAYMENT_COPY.status.timeout}
              </Text>
              <Button variant="secondary" size="md" onPress={restartPolling}>
                {PAYMENT_COPY.cta.checkAgain}
              </Button>
            </Card>
          ) : null}

          {/* Dev Fake Payment Panel (AC2: inline __DEV__ check) */}
          {__DEV__ && pendingOrderId !== null ? (
            <DevFakePaymentPanel orderId={pendingOrderId} onDone={restartPolling} />
          ) : null}
        </View>
      </ScrollView>

      {/* CTA đáy cố định (khi phase ≠ 'succeeded') */}
      {phase !== 'succeeded' ? (
        <View className="absolute bottom-0 left-0 right-0 p-margin bg-surface/95 border-t border-surface-container-high/60 flex-col gap-2 shadow-lg">
          {submitError ? (
            <View
              accessibilityRole="alert"
              className="p-space-sm rounded-lg bg-error-container/40 border border-error/30 gap-1"
            >
              <Text variant="label-md" className="font-semibold text-error text-center">
                {submitError.title}
              </Text>
              {submitError.action ? (
                <Text variant="body-sm" className="text-secondary text-center">
                  {submitError.action}
                </Text>
              ) : null}
            </View>
          ) : null}

          <Button
            testID="payment-cta"
            variant="primary"
            size="lg"
            fullWidth
            loading={checkout.isPending}
            disabled={checkout.isPending}
            onPress={() => void handleCtaPress()}
          >
            {ctaLabel}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
