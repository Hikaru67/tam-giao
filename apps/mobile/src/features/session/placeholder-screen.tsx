import { View } from 'react-native';
import { Button, Text } from '@tamgiao/ui-mobile';
import { SESSION_COPY } from './copy.js';
import { useLogout } from './use-logout.js';

export interface PlaceholderScreenProps {
  title: string;
  taskId: string;
}

/**
 * Màn hình giữ chỗ tạm thời (placeholder) cho các giai đoạn tiếp theo của ứng dụng.
 * Cho phép điều hướng kiểm thử luồng onboarding và hỗ trợ nút Đăng xuất.
 */
export function PlaceholderScreen({ title, taskId }: PlaceholderScreenProps) {
  const logout = useLogout();

  return (
    <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-md">
      <Text variant="headline-sm" className="font-bold text-on-surface text-center">
        {title}
      </Text>
      <Text variant="body-md" className="text-secondary text-center">
        {SESSION_COPY.placeholderScreen.building(taskId)}
      </Text>
      <Button
        variant="ghost"
        size="md"
        loading={logout.isPending}
        disabled={logout.isPending}
        onPress={() => logout.mutate()}
      >
        {SESSION_COPY.placeholderScreen.logoutButton}
      </Button>
    </View>
  );
}
