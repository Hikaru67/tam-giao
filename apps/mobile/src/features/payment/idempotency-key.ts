/**
 * Sinh chuỗi khoá idempotency cho request thanh toán (khớp `idempotencyKeySchema`: 8-128 ký tự, [A-Za-z0-9._:-]).
 */
export function createIdempotencyKey(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (webCrypto?.randomUUID) {
    return webCrypto.randomUUID();
  }
  return `vp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
