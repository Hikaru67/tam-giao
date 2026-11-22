import { useState } from 'react';
import { normalizeVnPhone } from '@tamgiao/ui-core';
import { TextInput, View, type TextInputProps } from 'react-native';
import { Text } from './text.js';

export interface PhoneInputProps extends Omit<TextInputProps, 'onChangeText' | 'value'> {
  label?: string;
  hint?: string;
  error?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  className?: string;
  onChangeE164?: (e164: string | null) => void;
  onChangeRaw?: (raw: string) => void;
}

export function PhoneInput({
  label,
  hint,
  error,
  value,
  defaultValue = '',
  disabled = false,
  placeholder = '0912 345 678',
  className = '',
  onChangeE164,
  onChangeRaw,
  accessibilityLabel,
  accessibilityHint,
  ...rest
}: PhoneInputProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentVal = value !== undefined ? value : internalValue;

  const handleChangeText = (raw: string) => {
    if (value === undefined) {
      setInternalValue(raw);
    }
    onChangeRaw?.(raw);
    const normalized = normalizeVnPhone(raw);
    onChangeE164?.(normalized);
  };

  return (
    <View className={`flex-col gap-space-xs w-full ${className}`.trim()}>
      {label ? (
        <Text variant="label-md" className="text-on-surface">
          {label}
        </Text>
      ) : null}
      <View
        className={`flex-row items-center rounded-md border bg-surface-container-lowest overflow-hidden ${
          error ? 'border-error' : 'border-outline-variant'
        } ${disabled ? 'opacity-50 bg-surface-container-low' : ''}`.trim()}
      >
        <View className="flex-row items-center gap-space-xs px-space-md py-space-xs bg-surface-container border-r border-outline-variant">
          <Text variant="label-md" className="font-semibold text-on-surface">
            🇻🇳 +84
          </Text>
        </View>
        <TextInput
          editable={!disabled}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          placeholder={placeholder}
          placeholderTextColor="#565e74"
          value={currentVal}
          onChangeText={handleChangeText}
          accessibilityLabel={accessibilityLabel ?? label ?? 'Số điện thoại di động'}
          accessibilityHint={accessibilityHint ?? hint}
          className="flex-1 min-h-[44px] px-space-md py-space-xs bg-transparent text-on-surface text-body-lg"
          {...rest}
        />
      </View>
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
