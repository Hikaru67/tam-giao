import { useState } from 'react';
import { Image, View, type ImageProps } from 'react-native';
import { Text } from './text.js';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps extends Partial<Omit<ImageProps, 'source' | 'src'>> {
  src?: string | null;
  initials?: string;
  size?: AvatarSize;
  className?: string;
}

const sizeContainerClasses: Record<AvatarSize, string> = {
  sm: 'w-8 h-8 rounded-full',
  md: 'w-12 h-12 rounded-full',
  lg: 'w-16 h-16 rounded-full',
};

export function Avatar({
  src,
  initials,
  size = 'md',
  className = '',
  accessibilityLabel,
  ...rest
}: AvatarProps) {
  const [loadError, setLoadError] = useState(false);
  const showImage = Boolean(src) && !loadError;
  const initialText = initials?.trim().slice(0, 2).toUpperCase() || '?';

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? initials ?? 'Ảnh đại diện'}
      className={`overflow-hidden items-center justify-center bg-primary-container ${sizeContainerClasses[size]} ${className}`.trim()}
    >
      {showImage ? (
        <Image
          source={{ uri: src! }}
          onError={() => setLoadError(true)}
          className="w-full h-full"
          {...rest}
        />
      ) : (
        <Text
          variant={size === 'sm' ? 'label-sm' : size === 'lg' ? 'headline-sm' : 'title-md'}
          className="font-bold text-on-primary-container"
        >
          {initialText}
        </Text>
      )}
    </View>
  );
}
