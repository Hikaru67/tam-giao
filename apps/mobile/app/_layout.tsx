import '../global.css';
import { useEffect, useState } from 'react';
import {
  BeVietnamPro_400Regular,
  BeVietnamPro_500Medium,
  BeVietnamPro_600SemiBold,
  BeVietnamPro_700Bold,
  useFonts,
} from '@expo-google-fonts/be-vietnam-pro';
import { ApiClientProvider } from '@tamgiao/api-client/react';
import { TokenStoreProvider } from '../src/session/token-store-context';
import { ToastProvider } from '@tamgiao/ui-mobile';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { apiClient, tokenStore } from '../src/session/api';
import { SessionGate } from '../src/features/session/session-gate';
import { PushRegistrar } from '../src/features/notifications/push-registrar.js';
import { observability, reportError } from '../src/observability/index.js';
import { FunnelTracker } from '../src/observability/funnel-tracker.js';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: reportError }),
        mutationCache: new MutationCache({ onError: reportError }),
      }),
  );
  // RN cần tên font khớp chính xác: đăng ký bản Regular dưới tên `fontFamily.sans` của preset token
  // ('Be Vietnam Pro'); các độ đậm khác giữ tên riêng — component Text (FE-S1-07) chọn theo fontWeight.
  const [fontsLoaded, fontError] = useFonts({
    'Be Vietnam Pro': BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  // SafeAreaProvider phải render trong code app (JSX runtime của NativeWind) để react-native-css-interop bơm insets cho
  // `pt-safe`/`pb-safe`. Provider dựng sẵn của expo-router không được bơm → inset = 0, header đè status bar (Android
  // edge-to-edge).
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <TokenStoreProvider store={tokenStore}>
            <ToastProvider>
              <SessionGate>
                {observability.enabled ? <FunnelTracker track={observability.trackFunnelStep} /> : null}
                <PushRegistrar />
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(onboarding)" />
                  <Stack.Screen name="(verification)" />
                  <Stack.Screen name="(main)" />
                </Stack>
              </SessionGate>
            </ToastProvider>
          </TokenStoreProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
