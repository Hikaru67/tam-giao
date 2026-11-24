import { useState } from 'react';
import { Button, Text } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useCurrentMatch } from '../match/use-match.js';
import { useForegroundNotification } from '../notifications/use-foreground-notification.js';
import { SAFETY_CENTER_COPY } from './copy.js';

export function SafetyCenterScreen() {
  const router = useRouter();
  const currentMatchQuery = useCurrentMatch();
  const currentMatch = currentMatchQuery.data?.match ?? null;
  const counterpart = currentMatch?.counterpart ?? null;

  const [hasReportUpdate, setHasReportUpdate] = useState(false);

  useForegroundNotification(['REPORT_RECEIVED', 'REPORT_UPDATED'], () => {
    setHasReportUpdate(true);
  });

  return (
    <View className="flex-1 bg-surface">
      {/* Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-gutter flex-row items-center gap-space-sm">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={SAFETY_CENTER_COPY.header.back}
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
              {SAFETY_CENTER_COPY.header.backIcon}
            </Text>
          </Pressable>
          <Text variant="title-md" numberOfLines={1} className="font-semibold text-on-surface flex-1">
            {SAFETY_CENTER_COPY.header.title}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerClassName="p-gutter pb-safe gap-space-md">
        {/* Banner thông báo push nếu nhận được khi đang mở */}
        {hasReportUpdate ? (
          <View
            testID="safety-report-updated"
            className="bg-primary/10 border border-primary/20 rounded-xl p-space-md"
          >
            <Text variant="label-md" className="font-semibold text-primary">
              {SAFETY_CENTER_COPY.notification.reportUpdated}
            </Text>
          </View>
        ) : null}

        {/* Trust Banner */}
        <View className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 gap-space-xs">
          <Text variant="headline-sm" className="font-bold text-on-surface">
            {SAFETY_CENTER_COPY.trustBanner.title}
          </Text>
          <Text variant="body-sm" className="text-secondary">
            {SAFETY_CENTER_COPY.trustBanner.description}
          </Text>
          <Text variant="label-sm" className="text-primary font-medium mt-1">
            {SAFETY_CENTER_COPY.trustBanner.secureNotice}
          </Text>
        </View>

        {/* Nguyên tắc an toàn */}
        <View className="bg-surface-container-lowest rounded-xl p-space-md border border-surface-container-high/60 gap-space-sm">
          <Text variant="title-md" className="font-semibold text-on-surface">
            {SAFETY_CENTER_COPY.guidelines.title}
          </Text>

          <View className="gap-space-xs">
            <View className="flex-row items-start gap-space-xs">
              <Text variant="label-md" className="text-primary font-bold">
                •
              </Text>
              <Text variant="body-sm" className="text-secondary flex-1">
                {SAFETY_CENTER_COPY.guidelines.item1}
              </Text>
            </View>

            <View className="flex-row items-start gap-space-xs">
              <Text variant="label-md" className="text-primary font-bold">
                •
              </Text>
              <Text variant="body-sm" className="text-secondary flex-1">
                {SAFETY_CENTER_COPY.guidelines.item2}
              </Text>
            </View>

            <View className="flex-row items-start gap-space-xs">
              <Text variant="label-md" className="text-primary font-bold">
                •
              </Text>
              <Text variant="body-sm" className="text-secondary flex-1">
                {SAFETY_CENTER_COPY.guidelines.item3}
              </Text>
            </View>
          </View>
        </View>

        {/* Khối hành động: có đối phương hoặc không có */}
        {counterpart !== null ? (
          <View className="bg-surface-container-lowest rounded-xl p-space-md border border-surface-container-high/60 gap-space-sm">
            <Text variant="title-md" className="font-semibold text-on-surface">
              {SAFETY_CENTER_COPY.action.currentMatchTitle}
            </Text>
            <Text variant="body-sm" className="text-secondary">
              {SAFETY_CENTER_COPY.action.nameAge(counterpart.displayName, counterpart.age)}
            </Text>
            <Button
              testID="safety-report-counterpart-btn"
              variant="danger"
              size="md"
              fullWidth
              onPress={() => {
                router.push({
                  pathname: '/(main)/safety/report',
                  params: { reportedUserId: counterpart.userId },
                });
              }}
            >
              {SAFETY_CENTER_COPY.action.reportButton(counterpart.displayName)}
            </Button>
          </View>
        ) : (
          <View className="bg-surface-container-lowest rounded-xl p-space-md border border-surface-container-high/60 gap-space-xs">
            <Text variant="title-md" className="font-semibold text-on-surface">
              {SAFETY_CENTER_COPY.action.noMatchTitle}
            </Text>
            <Text variant="body-sm" className="text-secondary">
              {SAFETY_CENTER_COPY.action.noMatchDescription}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
