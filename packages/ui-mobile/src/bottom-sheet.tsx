import type { ReactNode } from 'react';
import { Modal as RNModal, Pressable, View } from 'react-native';
import { Text } from './text.js';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function BottomSheet({ open, onClose, title, children, className = '' }: BottomSheetProps) {
  return (
    <RNModal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-on-surface/40">
        <Pressable
          accessibilityLabel="Đóng đáy trang"
          accessibilityRole="button"
          onPress={onClose}
          className="flex-1"
        />
        <View
          className={`bg-surface-container-lowest rounded-t-xl p-space-lg gap-space-md border-t border-surface-container-high ${className}`.trim()}
        >
          <View className="flex-row items-center justify-between">
            {title ? (
              <Text variant="headline-sm" className="font-bold text-on-surface">
                {title}
              </Text>
            ) : (
              <View />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Đóng"
              onPress={onClose}
              className="w-8 h-8 rounded-full items-center justify-center bg-surface-container"
            >
              <Text variant="label-md" className="font-bold text-secondary">
                ✕
              </Text>
            </Pressable>
          </View>
          <View>{children}</View>
        </View>
      </View>
    </RNModal>
  );
}
