import { Badge, Button, Card, Text } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { useRevokeSession, useSessions } from '../session/use-sessions.js';
import { SETTINGS_COPY } from './copy.js';

interface ConfirmRevokeState {
  id: string;
  deviceName: string;
}

export function SessionsScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useSessions();
  const revokeSession = useRevokeSession();
  const [confirmRevoke, setConfirmRevoke] = useState<ConfirmRevokeState | null>(null);

  const handleRevoke = async () => {
    if (!confirmRevoke) return;
    try {
      await revokeSession.mutateAsync(confirmRevoke.id);
      setConfirmRevoke(null);
    } catch {
      // lỗi được xử lý qua queryClient/state
    }
  };

  const sessions = data?.items ?? [];

  return (
    <ScrollView className="flex-1 bg-surface px-margin pt-safe pb-safe">
      <View className="py-space-md gap-space-lg max-w-md mx-auto w-full">
        {/* Navigation back and Header */}
        <View className="flex-row items-center gap-space-sm pb-space-xs">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quay lại"
            onPress={() => router.back()}
            className="p-space-xs rounded-full"
          >
            <Text variant="title-md" className="text-primary font-semibold">
              {SETTINGS_COPY.sessionsScreen.backButton}
            </Text>
          </Pressable>
        </View>

        <View className="gap-space-xs">
          <Text variant="headline-sm" className="font-bold text-on-surface">
            {SETTINGS_COPY.sessionsScreen.title}
          </Text>
          <Text variant="body-md" className="text-secondary">
            {SETTINGS_COPY.sessionsScreen.description}
          </Text>
        </View>

        {/* State: Loading */}
        {isLoading ? (
          <View className="py-space-xl items-center justify-center gap-space-sm">
            <ActivityIndicator size="small" />
            <Text variant="body-md" className="text-secondary">
              {SETTINGS_COPY.sessionsScreen.loading}
            </Text>
          </View>
        ) : null}

        {/* State: Error */}
        {isError ? (
          <Card className="gap-space-sm items-center py-space-lg">
            <Text variant="body-md" className="text-error text-center">
              {SETTINGS_COPY.sessionsScreen.error}
            </Text>
            <Button variant="secondary" onPress={() => refetch()}>
              {SETTINGS_COPY.sessionsScreen.retryButton}
            </Button>
          </Card>
        ) : null}

        {/* Sessions list */}
        {!isLoading && !isError ? (
          <View className="gap-space-sm">
            {sessions.length === 0 ? (
              <Card className="py-space-lg items-center">
                <Text variant="body-md" className="text-secondary text-center">
                  {SETTINGS_COPY.sessionsScreen.emptyList}
                </Text>
              </Card>
            ) : (
              sessions.map((session) => {
                const deviceName = session.deviceName ?? SETTINGS_COPY.sessionsScreen.unknownDevice;
                const formattedTime = new Date(session.lastUsedAt).toLocaleDateString('vi-VN', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <Card key={session.id} className="gap-space-sm">
                    <View className="flex-row items-start justify-between gap-space-sm">
                      <View className="flex-1">
                        <View className="flex-row items-center gap-space-xs flex-wrap">
                          <Text variant="title-md" className="font-semibold text-on-surface">
                            {deviceName}
                          </Text>
                          {session.current ? (
                            <Badge tone="success">{SETTINGS_COPY.sessionsScreen.currentDeviceBadge}</Badge>
                          ) : null}
                        </View>
                        <Text variant="body-sm" className="text-secondary mt-1">
                          {SETTINGS_COPY.sessionsScreen.lastActive(formattedTime)}
                        </Text>
                      </View>

                      {/* Thiết bị khác mới có nút thu hồi, thiết bị hiện tại không có */}
                      {!session.current ? (
                        <Button
                          variant="ghost"
                          size="md"
                          accessibilityLabel={SETTINGS_COPY.sessionsScreen.revokeA11yLabel(deviceName)}
                          onPress={() =>
                            setConfirmRevoke({
                              id: session.id,
                              deviceName,
                            })
                          }
                        >
                          {SETTINGS_COPY.sessionsScreen.revokeButton}
                        </Button>
                      ) : null}
                    </View>
                  </Card>
                );
              })
            )}
          </View>
        ) : null}
      </View>

      {/* Revoke confirmation modal */}
      <Modal visible={Boolean(confirmRevoke)} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center px-margin">
          <Card className="max-w-sm w-full gap-space-md">
            <Text variant="headline-sm" className="font-bold text-on-surface">
              {SETTINGS_COPY.sessionsScreen.revokeModal.title}
            </Text>
            <Text variant="body-md" className="text-secondary">
              {confirmRevoke
                ? SETTINGS_COPY.sessionsScreen.revokeModal.message(confirmRevoke.deviceName)
                : ''}
            </Text>
            <View className="flex-row gap-space-sm justify-end pt-space-xs">
              <Button
                variant="ghost"
                onPress={() => setConfirmRevoke(null)}
                accessibilityLabel={SETTINGS_COPY.sessionsScreen.revokeModal.cancelAction}
              >
                {SETTINGS_COPY.sessionsScreen.revokeModal.cancelAction}
              </Button>
              <Button
                variant="danger"
                loading={revokeSession.isPending}
                onPress={handleRevoke}
                accessibilityLabel={SETTINGS_COPY.sessionsScreen.revokeModal.confirmAction}
              >
                {SETTINGS_COPY.sessionsScreen.revokeModal.confirmAction}
              </Button>
            </View>
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}
