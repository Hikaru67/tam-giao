import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';
import { Text } from './text.js';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

export interface BadgeProps extends ViewProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: string;
  className?: string;
}

const toneContainerClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-container-high',
  success: 'bg-secondary-container',
  warning: 'bg-tertiary-fixed',
  danger: 'bg-error-container',
  primary: 'bg-primary-fixed',
};

const toneTextClasses: Record<BadgeTone, string> = {
  neutral: 'text-on-surface',
  success: 'text-on-secondary-container',
  warning: 'text-on-tertiary-fixed',
  danger: 'text-on-error-container',
  primary: 'text-on-primary-fixed',
};

export function Badge({ tone = 'neutral', icon, children, className = '', ...rest }: BadgeProps) {
  return (
    <View
      accessibilityRole="text"
      className={`flex-row items-center gap-space-xs px-space-sm py-0.5 rounded-full ${toneContainerClasses[tone]} ${className}`.trim()}
      {...rest}
    >
      {icon ? <View>{icon}</View> : null}
      <Text variant="label-sm" className={`font-semibold ${toneTextClasses[tone]}`}>
        {children}
      </Text>
    </View>
  );
}
