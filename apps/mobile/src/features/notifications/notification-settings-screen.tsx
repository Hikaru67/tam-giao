import { isApiError, messageFor } from '@tamgiao/api-client';
import { Badge, ErrorState, Text } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from 'react-native';
import { NOTIFICATIONS_COPY } from './copy.js';
import { useNotificationSettings, useUpdateNotificationSettings } from './use-notification-settings.js';

export function NotificationSettingsScreen() {
  const router = useRouter();
  const { data: settings, isLoading, error, refetch } = useNotificationSettings();
  const updateMutation = useUpdateNotificationSettings();

  const handleToggle = (key: 'matches' | 'messages' | 'dates', nextValue: boolean) => {
    if (!settings) return;
    const newBody = {
      matches: key === 'matches' ? nextValue : settings.matches,
      messages: key === 'messages' ? nextValue : settings.messages,
      dates: key === 'dates' ? nextValue : settings.dates,
    };
    updateMutation.mutate(newBody);
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !settings) {
    const errorView = isApiError(error) ? messageFor(error) : messageFor({ code: 'NETWORK_ERROR' });
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={errorView.title || NOTIFICATIONS_COPY.settings.errorTitle}
          action={errorView.action || NOTIFICATIONS_COPY.settings.retry}
          onRetry={() => {
            void refetch();
          }}
        />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-surface px-margin pt-safe pb-safe">
      <View className="py-space-md gap-space-lg max-w-md mx-auto w-full">
        {/* Header navigation */}
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quay lại"
            onPress={() => router.back()}
            className="px-space-xs py-space-xs rounded-full"
          >
            <Text variant="title-md" className="text-primary font-semibold">
              ← Quay lại
            </Text>
          </Pressable>
          <Text variant="title-md" className="font-semibold text-on-surface">
            {NOTIFICATIONS_COPY.settings.headerTitle}
          </Text>
          <View className="w-10" />
        </View>

        {/* Section: Thông báo có thể bật/tắt */}
        <View className="gap-space-sm">
          <Text variant="title-md" className="font-semibold text-secondary uppercase tracking-wider">
            {NOTIFICATIONS_COPY.settings.sectionInteractive}
          </Text>

          {/* MATCHES */}
          <View className="flex-row items-center justify-between bg-surface-container-low p-space-md rounded-xl gap-space-md">
            <View className="flex-1 gap-1">
              <Text variant="title-md" className="font-semibold text-on-surface">
                {NOTIFICATIONS_COPY.settings.categories.MATCH.title}
              </Text>
              <Text variant="body-sm" className="text-on-surface-variant">
                {NOTIFICATIONS_COPY.settings.categories.MATCH.description}
              </Text>
            </View>
            <Switch
              testID="switch-matches"
              accessibilityLabel={NOTIFICATIONS_COPY.settings.categories.MATCH.title}
              value={settings.matches}
              onValueChange={(val) => handleToggle('matches', val)}
              disabled={updateMutation.isPending}
            />
          </View>

          {/* MESSAGES */}
          <View className="flex-row items-center justify-between bg-surface-container-low p-space-md rounded-xl gap-space-md">
            <View className="flex-1 gap-1">
              <Text variant="title-md" className="font-semibold text-on-surface">
                {NOTIFICATIONS_COPY.settings.categories.MESSAGE.title}
              </Text>
              <Text variant="body-sm" className="text-on-surface-variant">
                {NOTIFICATIONS_COPY.settings.categories.MESSAGE.description}
              </Text>
            </View>
            <Switch
              testID="switch-messages"
              accessibilityLabel={NOTIFICATIONS_COPY.settings.categories.MESSAGE.title}
              value={settings.messages}
              onValueChange={(val) => handleToggle('messages', val)}
              disabled={updateMutation.isPending}
            />
          </View>

          {/* DATES */}
          <View className="flex-row items-center justify-between bg-surface-container-low p-space-md rounded-xl gap-space-md">
            <View className="flex-1 gap-1">
              <Text variant="title-md" className="font-semibold text-on-surface">
                {NOTIFICATIONS_COPY.settings.categories.DATE.title}
              </Text>
              <Text variant="body-sm" className="text-on-surface-variant">
                {NOTIFICATIONS_COPY.settings.categories.DATE.description}
              </Text>
            </View>
            <Switch
              testID="switch-dates"
              accessibilityLabel={NOTIFICATIONS_COPY.settings.categories.DATE.title}
              value={settings.dates}
              onValueChange={(val) => handleToggle('dates', val)}
              disabled={updateMutation.isPending}
            />
          </View>
        </View>

        {/* Section: Thông báo bắt buộc (ACCOUNT & SAFETY) */}
        <View className="gap-space-sm mt-space-sm">
          <Text variant="title-md" className="font-semibold text-secondary uppercase tracking-wider">
            {NOTIFICATIONS_COPY.settings.sectionMandatory}
          </Text>

          {/* ACCOUNT */}
          <View className="flex-row items-center justify-between bg-surface-container-low p-space-md rounded-xl gap-space-md opacity-90">
            <View className="flex-1 gap-1">
              <View className="flex-row items-center gap-space-xs">
                <Text variant="title-md" className="font-semibold text-on-surface">
                  {NOTIFICATIONS_COPY.settings.categories.ACCOUNT.title}
                </Text>
                <Badge tone="neutral">{NOTIFICATIONS_COPY.settings.categories.ACCOUNT.badge}</Badge>
              </View>
              <Text variant="body-sm" className="text-on-surface-variant">
                {NOTIFICATIONS_COPY.settings.categories.ACCOUNT.description}
              </Text>
            </View>
            <Switch
              testID="switch-account"
              accessibilityLabel={NOTIFICATIONS_COPY.settings.categories.ACCOUNT.title}
              value={true}
              disabled={true}
            />
          </View>

          {/* SAFETY */}
          <View className="flex-row items-center justify-between bg-surface-container-low p-space-md rounded-xl gap-space-md opacity-90">
            <View className="flex-1 gap-1">
              <View className="flex-row items-center gap-space-xs">
                <Text variant="title-md" className="font-semibold text-on-surface">
                  {NOTIFICATIONS_COPY.settings.categories.SAFETY.title}
                </Text>
                <Badge tone="neutral">{NOTIFICATIONS_COPY.settings.categories.SAFETY.badge}</Badge>
              </View>
              <Text variant="body-sm" className="text-on-surface-variant">
                {NOTIFICATIONS_COPY.settings.categories.SAFETY.description}
              </Text>
            </View>
            <Switch
              testID="switch-safety"
              accessibilityLabel={NOTIFICATIONS_COPY.settings.categories.SAFETY.title}
              value={true}
              disabled={true}
            />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
