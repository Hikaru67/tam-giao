import { createHmac } from 'node:crypto';
import { FakeClock } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { PaymentGatewayError } from '../application/ports/payment-gateway.js';
import { FAKE_SIGNATURE_HEADER, FakePaymentGateway } from '../infrastructure/gateway/fake-payment-gateway.js';
import { runPaymentGatewayContract } from './payment-gateway.contract.js';

const SECRET = 'test-webhook-secret';
const RETURN_URL = 'https://app.tamgiao.test/payments/return';

runPaymentGatewayContract('FakePaymentGateway', () => {
  const gateway = new FakePaymentGateway({ secret: SECRET, clock: new FakeClock() });
  return {
    gateway,
    signatureHeader: FAKE_SIGNATURE_HEADER,
    payAndCaptureWebhook: async (orderId, outcome) => gateway.simulatePayment(orderId, outcome),
  };
});

async function succeededTxn(gateway: FakePaymentGateway, orderId = 'order-1', amount = 299_000n) {
  await gateway.createCheckout(orderId, amount, RETURN_URL);
  const webhook = gateway.simulatePayment(orderId, 'SUCCEEDED');
  const event = await gateway.verifyWebhook(webhook.headers, webhook.rawBody);
  if (!event.ok) throw new Error('expected Ok');
  return event.value;
}

describe('FakePaymentGateway', () => {
  it('createCheckout embeds order, amount and return url', async () => {
    const gateway = new FakePaymentGateway({ secret: SECRET, checkoutBaseUrl: 'https://pay.dev/c' });
    const session = await gateway.createCheckout('order 1', 299_000n, RETURN_URL);
    const url = new URL(session.checkoutUrl);
    expect(url.origin + url.pathname).toBe('https://pay.dev/c/order%201');
    expect(url.searchParams.get('amount')).toBe('299000');
    expect(url.searchParams.get('returnUrl')).toBe(RETURN_URL);
    expect(session.qrData).toBe('FAKEPAY|order 1|299000');
  });

  it.each([0n, -1n])('createCheckout rejects non-positive amount %s', async (amount) => {
    const gateway = new FakePaymentGateway({ secret: SECRET });
    await expect(gateway.createCheckout('order-1', amount, RETURN_URL)).rejects.toMatchObject({
      name: 'PaymentGatewayError',
      kind: 'REJECTED',
      operation: 'createCheckout',
      retryable: false,
    });
  });

  it('simulatePayment signs the raw body with HMAC-SHA256 and uses the clock for occurredAt', async () => {
    const clock = new FakeClock(new Date('2026-11-18T03:04:05.000Z'));
    const gateway = new FakePaymentGateway({ secret: SECRET, clock });
    await gateway.createCheckout('order-1', 299_000n, RETURN_URL);
    const webhook = gateway.simulatePayment('order-1', 'SUCCEEDED');

    const expected = createHmac('sha256', SECRET).update(webhook.rawBody).digest('hex');
    expect(webhook.headers[FAKE_SIGNATURE_HEADER]).toBe(expected);
    const event = await gateway.verifyWebhook(webhook.headers, webhook.rawBody);
    expect(event.ok && event.value.occurredAt.toISOString()).toBe('2026-11-18T03:04:05.000Z');
  });

  it('simulatePayment for an order without checkout is a programming error', () => {
    const gateway = new FakePaymentGateway({ secret: SECRET });
    expect(() => gateway.simulatePayment('missing', 'SUCCEEDED')).toThrow(/no checkout/);
  });

  it('each simulated payment gets a distinct gateway transaction id', async () => {
    const gateway = new FakePaymentGateway({ secret: SECRET });
    await gateway.createCheckout('order-1', 299_000n, RETURN_URL);
    const a = JSON.parse(gateway.simulatePayment('order-1', 'FAILED').rawBody) as { gatewayTxnId: string };
    const b = JSON.parse(gateway.simulatePayment('order-1', 'SUCCEEDED').rawBody) as { gatewayTxnId: string };
    expect(a.gatewayTxnId).not.toBe(b.gatewayTxnId);
  });

  it('a webhook signed with another secret is invalid', async () => {
    const signer = new FakePaymentGateway({ secret: 'other-secret' });
    const verifier = new FakePaymentGateway({ secret: SECRET });
    await signer.createCheckout('order-1', 299_000n, RETURN_URL);
    const webhook = signer.simulatePayment('order-1', 'SUCCEEDED');
    const result = await verifier.verifyWebhook(webhook.headers, webhook.rawBody);
    expect(!result.ok && result.error).toBe('WEBHOOK_INVALID');
  });

  it.each([
    ['non-JSON body', 'not json'],
    ['JSON array', '[]'],
    ['missing fields', JSON.stringify({ orderId: 'order-1' })],
    [
      'fractional amount',
      JSON.stringify({
        gatewayTxnId: 't',
        orderId: 'o',
        amount: '1.5',
        status: 'SUCCEEDED',
        occurredAt: '2026-01-01T00:00:00Z',
      }),
    ],
    [
      'unknown status',
      JSON.stringify({
        gatewayTxnId: 't',
        orderId: 'o',
        amount: '1',
        status: 'PENDING',
        occurredAt: '2026-01-01T00:00:00Z',
      }),
    ],
    [
      'invalid date',
      JSON.stringify({
        gatewayTxnId: 't',
        orderId: 'o',
        amount: '1',
        status: 'FAILED',
        occurredAt: 'yesterday',
      }),
    ],
  ])('a correctly signed but malformed body (%s) is invalid', async (_label, rawBody) => {
    const gateway = new FakePaymentGateway({ secret: SECRET });
    const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex');
    const result = await gateway.verifyWebhook({ [FAKE_SIGNATURE_HEADER]: signature }, rawBody);
    expect(!result.ok && result.error).toBe('WEBHOOK_INVALID');
  });

  it('refund succeeds once and records the call', async () => {
    const gateway = new FakePaymentGateway({ secret: SECRET });
    const event = await succeededTxn(gateway);
    const receipt = await gateway.refund(event.gatewayTxnId, event.amount);
    expect(receipt.gatewayRefundId).toMatch(/^fake_refund_/);
    expect(gateway.refundCalls).toEqual([
      { gatewayTxnId: event.gatewayTxnId, amount: 299_000n, succeeded: true },
    ]);
  });

  it('refunding the same transaction twice is rejected permanently', async () => {
    const gateway = new FakePaymentGateway({ secret: SECRET });
    const event = await succeededTxn(gateway);
    await gateway.refund(event.gatewayTxnId, event.amount);
    await expect(gateway.refund(event.gatewayTxnId, event.amount)).rejects.toMatchObject({
      kind: 'REJECTED',
      retryable: false,
    });
  });

  it('refund of a FAILED transaction or above the paid amount is rejected', async () => {
    const gateway = new FakePaymentGateway({ secret: SECRET });
    await gateway.createCheckout('order-f', 299_000n, RETURN_URL);
    const failed = gateway.simulatePayment('order-f', 'FAILED');
    const failedEvent = await gateway.verifyWebhook(failed.headers, failed.rawBody);
    if (!failedEvent.ok) throw new Error('expected Ok');
    await expect(gateway.refund(failedEvent.value.gatewayTxnId, 299_000n)).rejects.toMatchObject({
      kind: 'REJECTED',
    });

    const event = await succeededTxn(gateway, 'order-s');
    await expect(gateway.refund(event.gatewayTxnId, 299_001n)).rejects.toMatchObject({
      kind: 'REJECTED',
    });
  });

  it('refund fails transiently the first N times, then succeeds', async () => {
    const gateway = new FakePaymentGateway({
      secret: SECRET,
      refundTransientFailures: 2,
      refundTransientKind: 'TIMEOUT',
    });
    const event = await succeededTxn(gateway);

    for (let i = 0; i < 2; i++) {
      const error = await gateway.refund(event.gatewayTxnId, event.amount).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error).toMatchObject({ kind: 'TIMEOUT', operation: 'refund', retryable: true });
    }
    await expect(gateway.refund(event.gatewayTxnId, event.amount)).resolves.toMatchObject({
      gatewayRefundId: expect.any(String),
    });
    expect(gateway.refundCalls.map((c) => c.succeeded)).toEqual([false, false, true]);
  });

  it('failNextRefunds reconfigures transient failures at runtime', async () => {
    const gateway = new FakePaymentGateway({ secret: SECRET });
    const event = await succeededTxn(gateway);
    gateway.failNextRefunds(1);
    await expect(gateway.refund(event.gatewayTxnId, event.amount)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
      retryable: true,
    });
    await expect(gateway.refund(event.gatewayTxnId, event.amount)).resolves.toBeDefined();
  });

  it('error message contains only operation and kind', () => {
    const error = new PaymentGatewayError('UNAVAILABLE', 'refund', { cause: new Error('socket hang up') });
    expect(error.message).toBe('Payment gateway refund failed: UNAVAILABLE');
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('rejects an empty secret', () => {
    expect(() => new FakePaymentGateway({ secret: '' })).toThrow();
  });
});
