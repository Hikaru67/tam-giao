import { useState } from 'react';
import { View } from 'react-native';
import { isApiError, messageFor } from '@tamgiao/api-client';
import type { DevFakePaymentBody } from '@tamgiao/contracts/billing';
import { Button, Card, Text } from '@tamgiao/ui-mobile';
import { PAYMENT_COPY } from './copy.js';
import { useDevFakePayment } from './use-verification-payment.js';

export function DevFakePaymentPanel({ orderId, onDone }: { orderId: string; onDone: () => void }) {
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
        {PAYMENT_COPY.dev.title}
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
          {PAYMENT_COPY.dev.succeed}
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
          {PAYMENT_COPY.dev.fail}
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
