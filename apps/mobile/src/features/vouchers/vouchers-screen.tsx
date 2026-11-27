import { useEffect, useState } from 'react';
import { isApiError, messageFor, type ApiError } from '@tamgiao/api-client';
import { formatLocalDate } from '../kyc/status-model.js';
import { useMyVouchers, usePartners, VOUCHERS_QUERY_KEY } from '../kyc/use-verification-status.js';
import { formatVnd } from '../payment/format.js';
import { useScreenCaptureProtection } from '../security/use-screen-capture-protection.js';
import { Badge, Button, Card, EmptyState, ErrorState, Text } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { VOUCHERS_COPY, VOUCHER_STATUS_LABELS, VOUCHER_STATUS_TONES } from './copy.js';
import { QrCode } from './qr-code.js';
import { useMaxBrightness } from './use-max-brightness.js';
import { useVoucherQr } from './use-voucher-qr.js';

export const VOUCHER_POLL_INTERVAL_MS = 5_000;

const TERMINAL_QR_ERROR_CODES: readonly string[] = [
  'VOUCHER_NOT_ACTIVE',
  'VOUCHER_ALREADY_REDEEMED',
  'VOUCHER_EXPIRED',
  'VOUCHER_NOT_FOUND',
];

/** Voucher không còn dùng được: xin lại mã cũng vô ích, phải làm mới danh sách. */
function isTerminalQrError(error: Error | null): error is ApiError {
  return isApiError(error) && TERMINAL_QR_ERROR_CODES.includes(error.code);
}

interface ActiveVoucherQrSectionProps {
  readonly voucherId: string;
}

function ActiveVoucherQrSection({ voucherId }: ActiveVoucherQrSectionProps) {
  useScreenCaptureProtection('voucher');
  useMaxBrightness(true);

  const queryClient = useQueryClient();
  const { token, isExpired, isLoading, error, refetch } = useVoucherQr(voucherId, true);

  // Poll GET /me/vouchers mỗi VOUCHER_POLL_INTERVAL_MS = 5_000 để biết REDEEMED
  useEffect(() => {
    const intervalId = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: VOUCHERS_QUERY_KEY });
    }, VOUCHER_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [queryClient]);

  // Lỗi /qr VOUCHER_NOT_ACTIVE/ALREADY_REDEEMED/EXPIRED → làm mới danh sách
  useEffect(() => {
    if (isTerminalQrError(error)) {
      void queryClient.invalidateQueries({ queryKey: VOUCHERS_QUERY_KEY });
    }
  }, [error, queryClient]);

  // Làm mới lỗi mà mã hiện tại còn hạn thì vẫn cho quét; chỉ báo lỗi khi không còn mã dùng được.
  if (error !== null && (token === null || isTerminalQrError(error))) {
    if (isTerminalQrError(error)) {
      const title = messageFor(error).title;
      return (
        <View className="p-space-sm bg-surface-container rounded-lg items-center">
          <Text variant="body-md" className="font-semibold text-error text-center">
            {title}
          </Text>
        </View>
      );
    }

    const title = messageFor(isApiError(error) ? error : { code: 'UNKNOWN' }).title;
    return (
      <View className="p-space-sm items-center">
        <ErrorState title={title} action={VOUCHERS_COPY.actions.retry} onRetry={() => void refetch()} />
      </View>
    );
  }

  if (isLoading || token === null || isExpired) {
    return (
      <View testID="voucher-qr-refreshing" className="items-center justify-center p-space-md gap-space-xs">
        <ActivityIndicator size="small" color={colors.primary} />
        <Text variant="body-sm" className="text-secondary">
          {VOUCHERS_COPY.qrRefreshing}
        </Text>
      </View>
    );
  }

  return (
    <View className="items-center justify-center gap-space-sm p-space-md bg-surface-container-lowest rounded-xl border border-surface-container-high">
      <QrCode value={token} pixelSize={220} />
      <Text variant="body-sm" className="text-secondary text-center px-space-sm">
        {VOUCHERS_COPY.qrInstructions}
      </Text>
    </View>
  );
}

export function VouchersScreen() {
  const router = useRouter();
  const vouchersQuery = useMyVouchers();
  const partnersQuery = usePartners();

  const [activeVoucherId, setActiveVoucherId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([vouchersQuery.refetch(), partnersQuery.refetch()]);
    setRefreshing(false);
  };

  const isInitialLoading = vouchersQuery.isLoading && vouchersQuery.data === undefined;
  if (isInitialLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="title-md" className="font-semibold text-primary">
          {VOUCHERS_COPY.loading}
        </Text>
      </View>
    );
  }

  const isInitialError = vouchersQuery.isError && vouchersQuery.data === undefined;
  if (isInitialError) {
    const errorTitle = messageFor(
      isApiError(vouchersQuery.error) ? vouchersQuery.error : { code: 'UNKNOWN' },
    ).title;
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={errorTitle}
          onRetry={() => {
            void vouchersQuery.refetch();
          }}
        />
      </View>
    );
  }

  const vouchers = vouchersQuery.data?.items ?? [];

  return (
    <View className="flex-1 bg-surface">
      {/* Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-margin flex-row items-center gap-space-sm">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={VOUCHERS_COPY.header.back}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(main)/home');
              }
            }}
            className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
          >
            <Text variant="title-md" className="text-primary font-bold">
              {VOUCHERS_COPY.header.backIcon}
            </Text>
          </Pressable>
          <Text variant="title-md" numberOfLines={1} className="font-semibold text-on-surface flex-1">
            {VOUCHERS_COPY.header.title}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 48 }}
        className="flex-1 px-margin"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.primary}
          />
        }
      >
        <View className="py-space-md gap-space-md max-w-md mx-auto w-full">
          {vouchers.length === 0 ? (
            <EmptyState title={VOUCHERS_COPY.empty.title} description={VOUCHERS_COPY.empty.description} />
          ) : (
            vouchers.map((voucher) => {
              const partnerName =
                voucher.partnerId !== null
                  ? (partnersQuery.data?.items.find((p) => p.id === voucher.partnerId)?.name ??
                    VOUCHERS_COPY.partner.assigned)
                  : VOUCHERS_COPY.partner.any;

              const expiryDate =
                voucher.status === 'REDEEMED' && voucher.redeemedAt !== null
                  ? VOUCHERS_COPY.expiry.redeemedAt(formatLocalDate(voucher.redeemedAt))
                  : voucher.expiresAt !== null
                    ? VOUCHERS_COPY.expiry.until(formatLocalDate(voucher.expiresAt))
                    : VOUCHERS_COPY.expiry.noExpiry;

              const isQrOpen = activeVoucherId === voucher.id && voucher.status === 'ACTIVE';

              return (
                <Card key={voucher.id} className="gap-space-sm">
                  <View className="flex-row items-center justify-between">
                    <Text variant="title-md" className="font-bold text-on-surface">
                      {formatVnd(voucher.valueVnd)}
                    </Text>
                    <Badge tone={VOUCHER_STATUS_TONES[voucher.status]}>
                      {VOUCHER_STATUS_LABELS[voucher.status]}
                    </Badge>
                  </View>

                  <View className="gap-space-xs">
                    <Text variant="body-sm" className="text-secondary">
                      {partnerName}
                    </Text>
                    <Text variant="body-sm" className="text-secondary">
                      {expiryDate}
                    </Text>
                  </View>

                  {voucher.status === 'RESERVED' ? (
                    <Text variant="body-sm" className="text-secondary">
                      {VOUCHERS_COPY.reservedHint}
                    </Text>
                  ) : null}

                  {voucher.status === 'REDEEMED' ? (
                    <View
                      testID="voucher-redeemed"
                      className="p-space-sm bg-surface-container rounded-lg items-center"
                    >
                      <Text variant="body-md" className="font-semibold text-secondary">
                        {VOUCHERS_COPY.redeemedBanner}
                      </Text>
                    </View>
                  ) : null}

                  {voucher.status === 'ACTIVE' ? (
                    <Button
                      testID={`voucher-show-${voucher.id}`}
                      variant={isQrOpen ? 'ghost' : 'primary'}
                      size="md"
                      fullWidth
                      onPress={() => {
                        setActiveVoucherId((current) => (current === voucher.id ? null : voucher.id));
                      }}
                    >
                      {isQrOpen ? VOUCHERS_COPY.actions.hideQr : VOUCHERS_COPY.actions.showQr}
                    </Button>
                  ) : null}

                  {isQrOpen ? <ActiveVoucherQrSection voucherId={voucher.id} /> : null}
                </Card>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}
