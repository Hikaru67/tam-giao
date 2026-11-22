import type { TypographyToken } from '@tamgiao/ui-tokens';
import { typography } from '@tamgiao/ui-tokens';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

export interface TextProps extends RNTextProps {
  variant?: TypographyToken;
  className?: string;
}

const fontWeightToFontFamily: Record<string, string> = {
  '400': 'Be Vietnam Pro',
  '500': 'BeVietnamPro_500Medium',
  '600': 'BeVietnamPro_600SemiBold',
  '700': 'BeVietnamPro_700Bold',
};

export function Text({ variant = 'body-md', className = '', style, ...rest }: TextProps) {
  const tokenWeight = typography[variant]?.fontWeight ?? '400';
  const fontFamily = fontWeightToFontFamily[tokenWeight] ?? 'Be Vietnam Pro';

  const combinedStyle: TextStyle = {
    fontFamily,
    ...(style as TextStyle),
  };

  return (
    <RNText
      className={`text-${variant} text-on-surface ${className}`.trim()}
      style={combinedStyle}
      {...rest}
    />
  );
}
