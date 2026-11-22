import { ActivityIndicator, Pressable, type PressableProps } from 'react-native';
import { Text } from './text.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  className?: string;
  children: string;
}

const variantContainerClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary active:bg-primary-container',
  secondary: 'bg-secondary-container active:bg-secondary-fixed-dim',
  ghost: 'bg-transparent active:bg-surface-container',
  danger: 'bg-error active:bg-error-container',
};

const variantTextClasses: Record<ButtonVariant, string> = {
  primary: 'text-on-primary',
  secondary: 'text-on-secondary-container',
  ghost: 'text-secondary',
  danger: 'text-on-error',
};

const sizeClasses: Record<ButtonSize, string> = {
  md: 'px-space-md py-space-xs min-h-[40px] rounded-md',
  lg: 'px-space-lg py-space-sm min-h-[48px] rounded-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  className = '',
  children,
  accessibilityLabel,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const isLg = size === 'lg';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={`flex-row items-center justify-center gap-space-xs ${
        variantContainerClasses[variant]
      } ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${
        isDisabled ? 'opacity-50' : ''
      } ${className}`.trim()}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'danger' ? '#ffffff' : '#0b1c30'}
        />
      ) : null}
      <Text variant={isLg ? 'title-md' : 'label-md'} className={`${variantTextClasses[variant]}`.trim()}>
        {children}
      </Text>
    </Pressable>
  );
}
