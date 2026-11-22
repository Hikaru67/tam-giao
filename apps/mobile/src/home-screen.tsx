import { Text, View } from 'react-native';

export function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-surface p-space-md">
      <Text className="text-headline-md font-bold text-primary">Tâm Giao</Text>
      <Text className="mt-space-xs text-body-md text-secondary">Khung ứng dụng (FE-S1-01)</Text>
    </View>
  );
}
