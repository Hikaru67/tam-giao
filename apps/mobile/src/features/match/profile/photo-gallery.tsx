import { useState } from 'react';
import { Text } from '@tamgiao/ui-mobile';
import {
  Dimensions,
  FlatList,
  Image,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  View,
} from 'react-native';
import { MATCH_PROFILE_COPY } from './copy.js';

export interface PhotoGalleryProps {
  photos: readonly { url: string; expiresAt?: string }[];
  displayName: string;
  onPhotoError?: (url: string) => void;
}

export function PhotoGallery({ photos, displayName, onPhotoError }: PhotoGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(() => Dimensions.get('window').width);

  if (photos.length === 0) {
    return (
      <View
        testID="profile-no-photo"
        className="w-full aspect-[4/3] rounded-xl bg-surface-container-high items-center justify-center p-space-md"
      >
        <Text variant="body-md" className="text-secondary text-center">
          {MATCH_PROFILE_COPY.noPhoto}
        </Text>
      </View>
    );
  }

  const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const contentOffset = event.nativeEvent?.contentOffset;
    const layoutMeasurement = event.nativeEvent?.layoutMeasurement;
    const width = layoutMeasurement?.width ?? 0;
    if (width > 0 && contentOffset) {
      const rawIndex = Math.round(contentOffset.x / width);
      const clampedIndex = Math.max(0, Math.min(rawIndex, photos.length - 1));
      setCurrentIndex(clampedIndex);
    }
  };

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0) {
          setContainerWidth(w);
        }
      }}
      className="relative w-full aspect-[3/4] rounded-xl overflow-hidden bg-surface-container-high"
    >
      <FlatList
        testID="profile-gallery"
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={photos}
        keyExtractor={(item, index) => `${item.url}-${index}`}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        renderItem={({ item, index }) => (
          <View style={{ width: containerWidth }} className="h-full">
            <Image
              testID={`profile-photo-${index}`}
              source={{ uri: item.url }}
              accessibilityLabel={MATCH_PROFILE_COPY.photoLabel(displayName, index + 1, photos.length)}
              onError={() => {
                onPhotoError?.(item.url);
              }}
              className="w-full h-full object-cover"
              resizeMode="cover"
            />
          </View>
        )}
      />

      <View className="absolute bottom-3 right-3 px-space-sm py-0.5 rounded-full bg-inverse-surface/70">
        <Text variant="label-sm" className="font-semibold text-inverse-on-surface">
          {MATCH_PROFILE_COPY.photoCounter(Math.min(currentIndex, photos.length - 1) + 1, photos.length)}
        </Text>
      </View>
    </View>
  );
}
