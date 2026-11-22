import { useEffect, useRef } from 'react';
import { useCountdown } from '@tamgiao/ui-core';
import { View, type ViewProps } from 'react-native';
import { Text } from './text.js';

export interface CountdownProps extends ViewProps {
  expiresAt: string | Date;
  onExpire?: () => void;
  prefixText?: string;
  className?: string;
}

export function Countdown({ expiresAt, onExpire, prefixText, className = '', ...rest }: CountdownProps) {
  const { formatted, expired } = useCountdown(expiresAt);
  const onExpireCalledRef = useRef(false);

  useEffect(() => {
    if (expired && !onExpireCalledRef.current) {
      onExpireCalledRef.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);

  return (
    <View
      accessibilityRole="timer"
      accessibilityLiveRegion="polite"
      className={`flex-row items-center gap-space-xs ${className}`.trim()}
      {...rest}
    >
      {prefixText ? (
        <Text variant="body-md" className="text-secondary">
          {prefixText}
        </Text>
      ) : null}
      <Text variant="title-md" className="font-semibold text-primary">
        {formatted}
      </Text>
    </View>
  );
}
