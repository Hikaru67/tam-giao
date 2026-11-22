import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

export interface CardProps extends ViewProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <View
      className={`bg-surface-container-lowest rounded-xl p-space-md border border-surface-container-high ${className}`.trim()}
      {...rest}
    >
      {children}
    </View>
  );
}
