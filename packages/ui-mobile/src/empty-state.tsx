import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from './text.js';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className = '' }: EmptyStateProps) {
  return (
    <View className={`items-center justify-center p-space-xl gap-space-sm ${className}`.trim()}>
      {icon ? (
        <View className="w-16 h-16 rounded-full bg-surface-container items-center justify-center mb-space-xs">
          {icon}
        </View>
      ) : null}
      <Text variant="title-md" className="font-bold text-on-surface text-center">
        {title}
      </Text>
      {description ? (
        <Text variant="body-md" className="text-secondary text-center">
          {description}
        </Text>
      ) : null}
      {action ? <View className="mt-space-sm">{action}</View> : null}
    </View>
  );
}
