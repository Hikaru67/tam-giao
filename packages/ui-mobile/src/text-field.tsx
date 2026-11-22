import { TextInput, View, type TextInputProps } from 'react-native';
import { Text } from './text.js';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string;
  /** Khoá ô nhập (map sang `editable={false}` của TextInput). */
  disabled?: boolean;
  className?: string;
}

export function TextField({
  label,
  hint,
  error,
  disabled = false,
  className = '',
  accessibilityLabel,
  accessibilityHint,
  ...rest
}: TextFieldProps) {
  return (
    <View className={`flex-col gap-space-xs w-full ${className}`.trim()}>
      {label ? (
        <Text variant="label-md" className="text-on-surface">
          {label}
        </Text>
      ) : null}
      <TextInput
        editable={!disabled}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint ?? hint}
        placeholderTextColor="#565e74"
        className={`w-full min-h-[44px] px-space-md py-space-xs rounded-md bg-surface-container-lowest text-on-surface text-body-md border ${
          error ? 'border-error' : 'border-outline-variant focus:border-primary'
        } ${disabled ? 'opacity-50 bg-surface-container-low' : ''}`.trim()}
        {...rest}
      />
      {error ? (
        <Text variant="body-sm" className="text-error">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="body-sm" className="text-secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
