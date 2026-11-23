import { isApiError, messageFor } from '@tamgiao/api-client';
import { ErrorState } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { usePaymentStatus } from '../payment/index.js';
import { KYC_COPY } from './copy.js';
import { useKycProgress } from './use-kyc.js';
import { resolveVerificationEntry } from './verification-entry.js';

/** Điểm vào `/(verification)/start`: chọn màn thanh toán / eKYC / trạng thái theo `GET /me/kyc` + `GET /me/payments`. */
export function VerificationStartScreen() {
  const kyc = useKycProgress();
  const payment = usePaymentStatus();

  if (kyc.isError || payment.query.isError) {
    const err = kyc.error ?? payment.query.error;
    const title = isApiError(err) ? messageFor(err).title : KYC_COPY.genericError;
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={title}
          onRetry={() => {
            if (kyc.isError) void kyc.refetch();
            if (payment.query.isError) void payment.query.refetch();
          }}
        />
      </View>
    );
  }

  if (kyc.data === undefined || payment.query.data === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-surface gap-space-sm">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <Redirect href={resolveVerificationEntry(kyc.data.status, payment.latest?.status ?? null)} />;
}
