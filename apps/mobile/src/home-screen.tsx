import { Badge, Button, Text } from '@tamgiao/ui-mobile';
import { View } from 'react-native';

export function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
      <Text variant="headline-md" className="font-bold text-primary">
        Tâm Giao
      </Text>
      <Text variant="body-md" className="text-secondary">
        Khung ứng dụng (FE-S1-01)
      </Text>
      <View className="flex-row items-center gap-space-xs mt-space-sm">
        <Badge tone="primary">Tiền Hôn Nhân</Badge>
        <Button variant="primary" size="md">
          Bắt đầu
        </Button>
      </View>
    </View>
  );
}
