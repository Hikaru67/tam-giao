/**
 * Sinh UUID v4 (RFC 4122).
 * Sử dụng crypto.randomUUID nếu có; trên môi trường không hỗ trợ (Hermes / React Native cũ),
 * tự sinh đúng bit version 4 và variant RFC 4122 từ hàm random (mặc định Math.random).
 * Khoá idempotency cho clientMessageId, không dùng cho bảo mật mật mã.
 */
export function createUuidV4(random?: (() => number) | undefined): string {
  if (random === undefined) {
    const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (typeof webCrypto?.randomUUID === 'function') {
      return webCrypto.randomUUID();
    }
  }

  const rand = random ?? Math.random;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(rand() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
