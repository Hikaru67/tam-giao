/**
 * Module CHỈ dành cho môi trường dev (FE-S6-03).
 * Chỉ được nạp qua `require` có điều kiện `__DEV__` trong `payment-screen.tsx`; không export từ `index.ts`.
 * Scanner `tools/security/scan-bundle.ts` sẽ fail nếu module này (hoặc route `/dev/`) lọt vào bundle production.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  webhookAckResponseSchema,
  type DevFakePaymentBody,
  type WebhookAckResponse,
} from '@tamgiao/contracts/billing';
import { Button, Card, Text } from '@tamgiao/ui-mobile';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { PAYMENT_COPY } from './copy.js';
import { DEV_FAKE_PAYMENT_COPY } from './dev-fake-payment-copy.js';
import { PAYMENTS_QUERY_KEY } from './use-verification-payment.js';

export interface DevFakePaymentPanelProps {
  orderId: string;
  onDone: () => void;
}

/**
 * Hook giả lập kết quả thanh toán cho môi trường dev qua `POST /dev/payments/fake/:orderId`.
 */
export function useDevFakePayment(): UseMutationResult<
  WebhookAckResponse,
  Error,
  { orderId: string; outcome: DevFakePaymentBody['outcome'] }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<WebhookAckResponse, Error, { orderId: string; outcome: DevFakePaymentBody['outcome'] }>({
    mutationFn: async ({ orderId, outcome }) => {
      return client.post<typeof webhookAckResponseSchema>(
        `/dev/payments/fake/${encodeURIComponent(orderId)}`,
        {
          body: { outcome },
          schema: webhookAckResponseSchema,
        },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PAYMENTS_QUERY_KEY });
    },
  });
}

export function DevFakePaymentPanel({ orderId, onDone }: DevFakePaymentPanelProps) {
  const devFakePayment = useDevFakePayment();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleOutcome = async (outcome: DevFakePaymentBody['outcome']) => {
    setErrorMessage(null);
    try {
      await devFakePayment.mutateAsync({ orderId, outcome });
      onDone();
    } catch (err) {
      if (isApiError(err)) {
        setErrorMessage(messageFor(err).title);
      } else {
        setErrorMessage(PAYMENT_COPY.genericError);
      }
    }
  };

  return (
    <Card className="border border-dashed border-outline-variant bg-surface-container-low p-space-md gap-space-sm">
      <Text variant="title-md" className="font-semibold text-on-surface">
        {DEV_FAKE_PAYMENT_COPY.title}
      </Text>
      <View className="flex-row gap-space-sm">
        <Button
          testID="dev-fake-pay-succeeded"
          variant="secondary"
          size="md"
          loading={devFakePayment.isPending}
          disabled={devFakePayment.isPending}
          onPress={() => void handleOutcome('SUCCEEDED')}
          className="flex-1"
        >
          {DEV_FAKE_PAYMENT_COPY.succeed}
        </Button>
        <Button
          testID="dev-fake-pay-failed"
          variant="ghost"
          size="md"
          loading={devFakePayment.isPending}
          disabled={devFakePayment.isPending}
          onPress={() => void handleOutcome('FAILED')}
          className="flex-1"
        >
          {DEV_FAKE_PAYMENT_COPY.fail}
        </Button>
      </View>
      {errorMessage ? (
        <Text variant="body-sm" className="text-error font-medium">
          {errorMessage}
        </Text>
      ) : null}
    </Card>
  );
}
