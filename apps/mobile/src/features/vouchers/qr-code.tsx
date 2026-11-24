import Svg, { Path } from 'react-native-svg';
import { colors } from '@tamgiao/ui-tokens';
import { qrPath } from './qr-path.js';
import { VOUCHERS_COPY } from './copy.js';

export interface QrCodeProps {
  readonly value: string;
  readonly pixelSize?: number | undefined;
}

export function QrCode({ value, pixelSize = 240 }: QrCodeProps) {
  const { size, d } = qrPath(value);

  return (
    <Svg
      testID="voucher-qr"
      accessibilityRole="image"
      accessibilityLabel={VOUCHERS_COPY.qrAccessibilityLabel}
      width={pixelSize}
      height={pixelSize}
      viewBox={`0 0 ${size} ${size}`}
      style={{ backgroundColor: colors['surface-container-lowest'] }}
    >
      <Path d={d} fill={colors['on-surface']} />
    </Svg>
  );
}
