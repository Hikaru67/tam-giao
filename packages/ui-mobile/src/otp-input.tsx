import { useRef, type ComponentRef } from 'react';
import { useOtpInput } from '@tamgiao/ui-core';
import { Pressable, TextInput, View } from 'react-native';
import { Text } from './text.js';

export interface OtpInputProps {
  onComplete: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: string;
  className?: string;
  accessibilityLabel?: string;
}

export function OtpInput({
  onComplete,
  disabled = false,
  autoFocus = false,
  error,
  className = '',
  accessibilityLabel = 'Mã xác thực OTP gồm 6 chữ số',
}: OtpInputProps) {
  const { value, setValue, digits } = useOtpInput(onComplete);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  const handlePressContainer = () => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  };

  return (
    <View className={`flex-col items-center gap-space-xs ${className}`.trim()}>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={setValue}
        maxLength={6}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus={autoFocus}
        editable={!disabled}
        accessibilityLabel={accessibilityLabel}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
        }}
      />
      <Pressable
        onPress={handlePressContainer}
        // 6 ô chỉ để hiển thị: ẩn khỏi trình đọc màn hình, nhãn nằm ở TextInput thật (tránh đọc trùng).
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        className="flex-row items-center justify-center gap-space-xs"
      >
        {digits.map((digit, index) => {
          const isFocused = !disabled && value.length === index;
          return (
            <View
              key={index}
              className={`w-12 h-14 items-center justify-center rounded-xl border bg-surface-container-lowest ${
                error
                  ? 'border-error'
                  : isFocused
                    ? 'border-primary ring-2 ring-primary'
                    : 'border-outline-variant'
              } ${disabled ? 'opacity-50 bg-surface-container-low' : ''}`.trim()}
            >
              <Text variant="headline-md" className="font-bold text-on-surface">
                {digit}
              </Text>
            </View>
          );
        })}
      </Pressable>
      {error ? (
        <Text variant="body-sm" className="text-error text-center">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
