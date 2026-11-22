import { messageFor } from '@tamgiao/api-client';
import { Button, ErrorState, Text } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { AUTH_COPY } from './copy.js';

export function BannedScreen() {
  const router = useRouter();
  const info = messageFor({ code: 'ACCOUNT_BANNED' });

  return (
    <View className="flex-1 bg-surface px-margin pt-safe pb-safe items-center justify-center">
      <View className="w-full max-w-md items-center gap-space-lg p-space-md">
        <ErrorState
          title={info.title}
          action={AUTH_COPY.bannedScreen.backButton}
          onRetry={() => {
            router.replace('/(auth)/phone');
          }}
        />

        {info.action ? (
          <Text variant="body-md" className="text-secondary text-center px-space-md">
            {info.action}
          </Text>
        ) : null}

        <Button
          variant="secondary"
          size="md"
          onPress={() => {
            router.replace('/(auth)/phone');
          }}
        >
          {AUTH_COPY.bannedScreen.backButton}
        </Button>
      </View>
    </View>
  );
}
