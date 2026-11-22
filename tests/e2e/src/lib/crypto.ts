import { createHmac } from 'node:crypto';

/** Giải mã Base32 RFC 4648 (A-Z, 2-7, bỏ padding) — secret TOTP trong URI `otpauth://` của `seed:admin`. */
function decodeBase32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('TOTP secret không phải Base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Mã TOTP RFC 6238 (HMAC-SHA1, 30 giây, 6 số) — giống app Authenticator của chuyên viên. */
export function totp(secret: string, now: Date = new Date()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 1000 / 30)));
  const hmac = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

/** Lấy `secret=` từ URI `otpauth://totp/...` (output của `pnpm --filter @tamgiao/tools seed:admin`). */
export function totpSecretFromUri(uri: string): string | undefined {
  return /[?&]secret=([A-Z2-7]+)/i.exec(uri)?.[1];
}

/** Header chữ ký của cổng thanh toán giả (`FakePaymentGateway`, BE-S4-02): HMAC-SHA256 hex trên raw body. */
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

/**
 * Webhook "thanh toán thành công" của cổng giả, ký bằng `PAYMENT_WEBHOOK_SECRET` — đóng vai cổng gọi
 * `POST /webhooks/payments/fake` (không đi qua endpoint giả lập `/dev/payments/fake/:orderId`).
 */
export function signedFakeWebhook(
  secret: string,
  payment: { readonly orderId: string; readonly amountVnd: number; readonly gatewayTxnId: string },
  now: Date = new Date(),
): { readonly headers: Record<string, string>; readonly rawBody: string } {
  const rawBody = JSON.stringify({
    gatewayTxnId: payment.gatewayTxnId,
    orderId: payment.orderId,
    amount: String(payment.amountVnd),
    status: 'SUCCEEDED',
    occurredAt: now.toISOString(),
  });
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
  return { headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: signature }, rawBody };
}
