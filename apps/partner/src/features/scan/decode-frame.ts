import jsQR from 'jsqr';

/**
 * Giải mã khung hình raw RGBA bằng jsQR.
 * Trả về chuỗi token nếu tìm thấy mã QR hợp lệ, ngược lại trả về null.
 */
export function decodeQr(data: Uint8ClampedArray, width: number, height: number): string | null {
  if (width <= 0 || height <= 0 || data.length === 0) {
    return null;
  }
  try {
    const code = jsQR(data, width, height);
    if (!code || !code.data) {
      return null;
    }
    const trimmed = code.data.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
