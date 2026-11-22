import { useEffect, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { ErrorState, Text } from '@tamgiao/ui-mobile';
import { Redirect, type Href } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useTokenStore } from '../../session/token-store-context.js';
import { SESSION_COPY } from './copy.js';
import { routeForOnboarding } from './onboarding-route.js';
import { useMe } from './use-me.js';

/**
 * Màn hình cổng vào ứng dụng (EntryScreen):
 * 1. Kiểm tra access token từ token store.
 * 2. Chưa có token -> điều hướng sang màn đăng nhập SĐT.
 * 3. Có token -> gọi GET /me để lấy thông tin onboardingStep.
 * 4. Đang tải -> hiển thị splash nhỏ với spinner và thương hiệu "Tâm Giao".
 * 5. Lỗi -> hiển thị ErrorState và nút Thử lại.
 * 6. Thành công -> điều hướng sang màn hình tương ứng với bước onboarding.
 */
export function EntryScreen() {
  const tokenStore = useTokenStore();
  const [tokenChecked, setTokenChecked] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    let mounted = true;
    void tokenStore.getAccessToken().then((token) => {
      if (mounted) {
        setHasToken(Boolean(token));
        setTokenChecked(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, [tokenStore]);

  const { data: me, isLoading, error, refetch } = useMe({ enabled: tokenChecked && hasToken });

  if (!tokenChecked) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" />
        <Text variant="title-md" className="font-semibold text-primary">
          {SESSION_COPY.brandName}
        </Text>
      </View>
    );
  }

  if (!hasToken) {
    return <Redirect href="/(auth)/phone" />;
  }

  if (isLoading || (!me && !error)) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" />
        <Text variant="title-md" className="font-semibold text-primary">
          {SESSION_COPY.brandName}
        </Text>
      </View>
    );
  }

  if (error) {
    const errorView = isApiError(error) ? messageFor(error) : messageFor({ code: 'NETWORK_ERROR' });

    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={errorView.title}
          action={errorView.action ?? SESSION_COPY.entryScreen.retry}
          onRetry={() => {
            void refetch();
          }}
        />
      </View>
    );
  }

  if (me) {
    return <Redirect href={routeForOnboarding(me.onboardingStep) as Href<string>} />;
  }

  return null;
}
