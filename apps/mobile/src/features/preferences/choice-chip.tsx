import { Text } from '@tamgiao/ui-mobile';
import { Pressable } from 'react-native';

export interface ChoiceChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean | undefined;
  accessibilityLabel?: string | undefined;
  className?: string | undefined;
}

export function ChoiceChip({
  label,
  selected,
  onPress,
  disabled = false,
  accessibilityLabel,
  className = '',
}: ChoiceChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      className={`px-3.5 py-2 rounded-full flex-row items-center justify-center gap-1.5 ${
        selected ? 'bg-primary shadow-sm' : 'bg-surface-container-low border border-outline-variant/30'
      } ${disabled ? 'opacity-50' : 'active:opacity-80'} ${className}`.trim()}
    >
      <Text
        variant="label-md"
        className={selected ? 'text-on-primary font-semibold' : 'text-secondary font-medium'}
      >
        {label}
      </Text>
      {selected ? (
        <Text variant="label-sm" className="text-on-primary font-bold">
          ✓
        </Text>
      ) : null}
    </Pressable>
  );
}
