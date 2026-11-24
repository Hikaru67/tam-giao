import qrcodeGenerator from 'qrcode-generator';

const getQrFactory = () => {
  if (typeof qrcodeGenerator === 'function') {
    return qrcodeGenerator;
  }
  const maybeDefault = (qrcodeGenerator as unknown as { default: typeof qrcodeGenerator }).default;
  if (typeof maybeDefault === 'function') {
    return maybeDefault;
  }
  return qrcodeGenerator;
};

export interface QrPathResult {
  readonly size: number;
  readonly d: string;
}

/**
 * Tính toán kích thước SVG và chuỗi lệnh path d cho mã QR.
 * Dùng qrcode-generator với typeNumber 0, mức sửa lỗi 'M'.
 * Viền trắng 4 ô mỗi phía (toạ độ đã cộng viền).
 * Gộp các ô đen liên tiếp trên một hàng thành `M{x} {y}h{n}v1h-{n}z`.
 */
export function qrPath(text: string): QrPathResult {
  const factory = getQrFactory();
  const qr = factory(0, 'M');
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const margin = 4;
  const size = moduleCount + margin * 2;
  const pathSegments: string[] = [];

  for (let row = 0; row < moduleCount; row += 1) {
    let col = 0;
    while (col < moduleCount) {
      if (qr.isDark(row, col)) {
        const startCol = col;
        while (col < moduleCount && qr.isDark(row, col)) {
          col += 1;
        }
        const length = col - startCol;
        const x = startCol + margin;
        const y = row + margin;
        pathSegments.push(`M${x} ${y}h${length}v1h-${length}z`);
      } else {
        col += 1;
      }
    }
  }

  return {
    size,
    d: pathSegments.join(''),
  };
}
