import { View } from 'react-native';
import { Button } from './button.js';
import { Text } from './text.js';

export interface ErrorStateProps {
  title: string;
  action?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title, action = 'Thử lại', onRetry, className = '' }: ErrorStateProps) {
  return (
    <View
      accessibilityRole="alert"
      className={`items-center justify-center p-space-xl gap-space-sm ${className}`.trim()}
    >
      <View
        className="w-16 h-16 rounded-full bg-error-container items-center justify-center mb-space-xs"
        accessibilityElementsHidden={true}
      >
        <Text variant="headline-md" className="font-bold text-on-error-container">
          !
        </Text>
      </View>
      <Text variant="title-md" className="font-bold text-error text-center">
        {title}
      </Text>
      {onRetry ? (
        <View className="mt-space-sm">
          <Button variant="danger" size="md" onPress={onRetry}>
            {action}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
