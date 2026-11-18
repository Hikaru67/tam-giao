import { describe, expect, it } from 'vitest';
import {
  PaymentGatewayError,
  WEBHOOK_INVALID,
  type PaymentGateway,
  type WebhookPaymentStatus,
} from '../application/ports/payment-gateway.js';

export interface ContractSignedWebhook {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
}

export interface PaymentGatewayContractSubject {
  readonly gateway: PaymentGateway;
  /** Tên header chứa chữ ký webhook của adapter (vd `x-fake-signature`, `x-payos-signature`). */
  readonly signatureHeader: string;
  /**
   * Cho đơn `orderId` (đã `createCheckout`) được thanh toán với kết quả `outcome` và trả webhook đã ký
   * đúng như cổng gửi. Fake: `simulatePayment`; adapter thật: sandbox của nhà cung cấp.
   */
  readonly payAndCaptureWebhook: (
    orderId: string,
    outcome: WebhookPaymentStatus,
  ) => Promise<ContractSignedWebhook>;
}

const AMOUNT = 299_000n;
const RETURN_URL = 'https://app.tamgiao.test/payments/return';

let seq = 0;
function nextOrderId(): string {
  seq += 1;
  return `contract-order-${String(seq).padStart(6, '0')}`;
}

/** Thay 1 ký tự hex của chữ ký bằng ký tự khác (giữ nguyên độ dài). */
function corrupt(signature: string): string {
  const last = signature.at(-1);
  return `${signature.slice(0, -1)}${last === '0' ? '1' : '0'}`;
}

function withoutHeader(headers: Readonly<Record<string, string>>, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== name.toLowerCase()));
}

function signatureOf(webhook: ContractSignedWebhook, name: string): string {
  const entry = Object.entries(webhook.headers).find(([k]) => k.toLowerCase() === name.toLowerCase());
  if (entry === undefined) throw new Error(`webhook has no ${name} header`);
  return entry[1];
}

/**
 * Hợp đồng chung của mọi `PaymentGateway` (BE-S4-02 AC1/AC2). Adapter thật (khi chốt D3) gọi lại hàm này
 * trong file test của nó với sandbox của nhà cung cấp.
 */
export function runPaymentGatewayContract(
  name: string,
  createSubject: () => PaymentGatewayContractSubject,
): void {
  describe(`PaymentGateway contract: ${name}`, () => {
    async function paidWebhook(outcome: WebhookPaymentStatus = 'SUCCEEDED') {
      const subject = createSubject();
      const orderId = nextOrderId();
      await subject.gateway.createCheckout(orderId, AMOUNT, RETURN_URL);
      const webhook = await subject.payAndCaptureWebhook(orderId, outcome);
      return { subject, orderId, webhook };
    }

    it('createCheckout returns an absolute checkout url and non-empty qr data', async () => {
      const { gateway } = createSubject();
      const session = await gateway.createCheckout(nextOrderId(), AMOUNT, RETURN_URL);
      expect(() => new URL(session.checkoutUrl)).not.toThrow();
      expect(new URL(session.checkoutUrl).protocol).toMatch(/^https?:$/);
      expect(session.qrData.length).toBeGreaterThan(0);
    });

    it.each(['SUCCEEDED', 'FAILED'] as const)('verifyWebhook parses a valid %s webhook', async (outcome) => {
      const { subject, orderId, webhook } = await paidWebhook(outcome);
      const result = await subject.gateway.verifyWebhook(webhook.headers, webhook.rawBody);
      if (!result.ok) throw new Error(`expected Ok, got ${result.error}`);
      expect(result.value.orderId).toBe(orderId);
      expect(result.value.amount).toBe(AMOUNT);
      expect(typeof result.value.amount).toBe('bigint');
      expect(result.value.status).toBe(outcome);
      expect(result.value.gatewayTxnId.length).toBeGreaterThan(0);
      expect(result.value.occurredAt).toBeInstanceOf(Date);
      expect(Number.isNaN(result.value.occurredAt.getTime())).toBe(false);
    });

    it('verifyWebhook matches the signature header case-insensitively', async () => {
      const { subject, webhook } = await paidWebhook();
      const upper = Object.fromEntries(Object.entries(webhook.headers).map(([k, v]) => [k.toUpperCase(), v]));
      expect((await subject.gateway.verifyWebhook(upper, webhook.rawBody)).ok).toBe(true);
    });

    it('verifyWebhook is stable when the same webhook is delivered again', async () => {
      const { subject, webhook } = await paidWebhook();
      const first = await subject.gateway.verifyWebhook(webhook.headers, webhook.rawBody);
      const second = await subject.gateway.verifyWebhook(webhook.headers, webhook.rawBody);
      if (!first.ok || !second.ok) throw new Error('expected Ok twice');
      expect(second.value.gatewayTxnId).toBe(first.value.gatewayTxnId);
    });

    it('rejects a wrong signature with WEBHOOK_INVALID', async () => {
      const { subject, webhook } = await paidWebhook();
      const header = subject.signatureHeader;
      const headers = {
        ...withoutHeader(webhook.headers, header),
        [header]: corrupt(signatureOf(webhook, header)),
      };
      const result = await subject.gateway.verifyWebhook(headers, webhook.rawBody);
      expect(!result.ok && result.error).toBe(WEBHOOK_INVALID);
    });

    it('rejects a garbage signature with WEBHOOK_INVALID', async () => {
      const { subject, webhook } = await paidWebhook();
      const header = subject.signatureHeader;
      const headers = { ...withoutHeader(webhook.headers, header), [header]: 'not-a-signature' };
      const result = await subject.gateway.verifyWebhook(headers, webhook.rawBody);
      expect(!result.ok && result.error).toBe(WEBHOOK_INVALID);
    });

    it('rejects a tampered body with WEBHOOK_INVALID', async () => {
      const { subject, orderId, webhook } = await paidWebhook();
      expect(webhook.rawBody).toContain(orderId);
      const tampered = webhook.rawBody.replace(orderId, nextOrderId());
      const result = await subject.gateway.verifyWebhook(webhook.headers, tampered);
      expect(!result.ok && result.error).toBe(WEBHOOK_INVALID);
    });

    it('rejects a FAILED webhook relabelled as SUCCEEDED with WEBHOOK_INVALID', async () => {
      const { subject, webhook } = await paidWebhook('FAILED');
      const tampered = webhook.rawBody.replace('FAILED', 'SUCCEEDED');
      expect(tampered).not.toBe(webhook.rawBody);
      const result = await subject.gateway.verifyWebhook(webhook.headers, tampered);
      expect(!result.ok && result.error).toBe(WEBHOOK_INVALID);
    });

    it('rejects a webhook without the signature header with WEBHOOK_INVALID', async () => {
      const { subject, webhook } = await paidWebhook();
      const headers = withoutHeader(webhook.headers, subject.signatureHeader);
      const result = await subject.gateway.verifyWebhook(headers, webhook.rawBody);
      expect(!result.ok && result.error).toBe(WEBHOOK_INVALID);
    });

    it('rejects a webhook signed by another party with WEBHOOK_INVALID', async () => {
      const { subject, webhook } = await paidWebhook();
      const other = await paidWebhook();
      const header = subject.signatureHeader;
      const headers = {
        ...withoutHeader(webhook.headers, header),
        [header]: signatureOf(other.webhook, header),
      };
      const result = await subject.gateway.verifyWebhook(headers, webhook.rawBody);
      expect(!result.ok && result.error).toBe(WEBHOOK_INVALID);
    });

    it('refund of a succeeded transaction returns a gateway refund id', async () => {
      const { subject, webhook } = await paidWebhook('SUCCEEDED');
      const event = await subject.gateway.verifyWebhook(webhook.headers, webhook.rawBody);
      if (!event.ok) throw new Error('expected Ok');
      const receipt = await subject.gateway.refund(event.value.gatewayTxnId, event.value.amount);
      expect(receipt.gatewayRefundId.length).toBeGreaterThan(0);
    });

    it('refund of an unknown transaction throws a non-retryable PaymentGatewayError', async () => {
      const { gateway } = createSubject();
      const error = await gateway.refund('unknown-txn-id', AMOUNT).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect((error as PaymentGatewayError).operation).toBe('refund');
      expect((error as PaymentGatewayError).retryable).toBe(false);
    });
  });
}
