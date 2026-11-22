import { Button, Card, Text } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useLogout } from '../session/use-logout.js';
import { SETTINGS_COPY } from './copy.js';

export function SettingsScreen() {
  const router = useRouter();
  const logout = useLogout();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogout = async () => {
    setShowLogoutConfirm(false);
    await logout.mutateAsync();
  };

  return (
    <ScrollView className="flex-1 bg-surface px-margin pt-safe pb-safe">
      <View className="py-space-md gap-space-lg max-w-md mx-auto w-full">
        {/* Header */}
        <View className="flex-row items-center justify-between pb-space-xs">
          <Text variant="headline-sm" className="font-bold text-on-surface">
            {SETTINGS_COPY.headerTitle}
          </Text>
        </View>

        {/* Section: General */}
        <View className="gap-space-sm">
          <Text variant="title-md" className="font-semibold text-secondary uppercase tracking-wider">
            {SETTINGS_COPY.sections.general}
          </Text>

          <Card className="p-0 overflow-hidden divide-y divide-surface-container">
            {/* Mục Thông báo */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={SETTINGS_COPY.items.notifications.title}
              onPress={() => router.push('/(main)/settings/notifications')}
              className="p-space-md flex-row items-center justify-between active:bg-surface-container-low"
            >
              <View className="flex-1 pr-space-sm">
                <Text variant="title-md" className="font-semibold text-on-surface">
                  {SETTINGS_COPY.items.notifications.title}
                </Text>
                <Text variant="body-sm" className="text-secondary mt-0.5">
                  {SETTINGS_COPY.items.notifications.subtitle}
                </Text>
              </View>
              <Text variant="title-md" className="text-secondary">
                ›
              </Text>
            </Pressable>

            {/* Mục Thiết bị đăng nhập */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={SETTINGS_COPY.items.sessions.title}
              onPress={() => router.push('/(main)/settings/sessions')}
              className="p-space-md flex-row items-center justify-between active:bg-surface-container-low"
            >
              <View className="flex-1 pr-space-sm">
                <Text variant="title-md" className="font-semibold text-on-surface">
                  {SETTINGS_COPY.items.sessions.title}
                </Text>
                <Text variant="body-sm" className="text-secondary mt-0.5">
                  {SETTINGS_COPY.items.sessions.subtitle}
                </Text>
              </View>
              <Text variant="title-md" className="text-secondary">
                ›
              </Text>
            </Pressable>
          </Card>
        </View>

        {/* Section: Privacy & Data Rights */}
        <View className="gap-space-sm">
          <Text variant="title-md" className="font-semibold text-secondary uppercase tracking-wider">
            {SETTINGS_COPY.sections.privacy}
          </Text>

          <Card className="p-0 overflow-hidden">
            {/* Mục Quyền dữ liệu cá nhân */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={SETTINGS_COPY.items.account.title}
              onPress={() => router.push('/(main)/settings/account')}
              className="p-space-md flex-row items-center justify-between active:bg-surface-container-low"
            >
              <View className="flex-1 pr-space-sm">
                <Text variant="title-md" className="font-semibold text-on-surface">
                  {SETTINGS_COPY.items.account.title}
                </Text>
                <Text variant="body-sm" className="text-secondary mt-0.5">
                  {SETTINGS_COPY.items.account.subtitle}
                </Text>
              </View>
              <Text variant="title-md" className="text-secondary">
                ›
              </Text>
            </Pressable>
          </Card>
        </View>

        {/* Logout button */}
        <View className="pt-space-md">
          <Button
            variant="danger"
            fullWidth
            loading={logout.isPending}
            onPress={() => setShowLogoutConfirm(true)}
            accessibilityLabel={SETTINGS_COPY.logout.button}
          >
            {SETTINGS_COPY.logout.button}
          </Button>
        </View>
      </View>

      {/* Logout confirmation modal */}
      <Modal visible={showLogoutConfirm} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center px-margin">
          <Card className="max-w-sm w-full gap-space-md">
            <Text variant="headline-sm" className="font-bold text-on-surface">
              {SETTINGS_COPY.logout.confirmTitle}
            </Text>
            <Text variant="body-md" className="text-secondary">
              {SETTINGS_COPY.logout.confirmMessage}
            </Text>
            <View className="flex-row gap-space-sm justify-end pt-space-xs">
              <Button
                variant="ghost"
                onPress={() => setShowLogoutConfirm(false)}
                accessibilityLabel={SETTINGS_COPY.logout.cancelAction}
              >
                {SETTINGS_COPY.logout.cancelAction}
              </Button>
              <Button
                variant="danger"
                loading={logout.isPending}
                onPress={handleLogout}
                accessibilityLabel={SETTINGS_COPY.logout.confirmAction}
              >
                {SETTINGS_COPY.logout.confirmAction}
              </Button>
            </View>
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}
