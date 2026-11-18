import { REFUND_SLA_HOURS } from '@tamgiao/contracts';
import type { JobLogger } from '@tamgiao/db';
import { fail, ok } from '@tamgiao/kernel';
import { PaymentGatewayError, type RefundVerificationPaymentOutcome } from '@tamgiao/module-billing';
import { describe, expect, it } from 'vitest';
import {
  BILLING_REFUND_SLA_QUEUE,
  checkRefundSla,
  dispatchPendingRefunds,
  refundPaymentJobId,
  runRefundPayment,
} from '../billing-refund.js';

interface Line {
  readonly level: 'info' | 'warn' | 'error';
  readonly obj: Record<string, unknown>;
  readonly msg: string;
}

function recordingLogger(): JobLogger & { lines: Line[] } {
  const lines: Line[] = [];
  const push = (level: Line['level']) => (obj: object, msg: string) =>
    void lines.push({ level, obj: obj as Record<string, unknown>, msg });
  return { lines, info: push('info'), warn: push('warn'), error: push('error') };
}

const PAYMENT_ID = '0193a1b2-0000-7000-8000-000000000001';
const runner = (impl: () => Promise<RefundVerificationPaymentOutcome>) => ({
  execute: async () => ok(await impl()),
});

describe('runRefundPayment', () => {
  it('REFUNDED → log info', async () => {
    const logger = recordingLogger();
    await runRefundPayment(
      runner(async () => ({ kind: 'REFUNDED', paymentId: PAYMENT_ID })),
      PAYMENT_ID,
      logger,
    );
    expect(logger.lines.map((l) => l.level)).toEqual(['info']);
  });

  it('cổng lỗi tạm thời → log warn + throw để pg-boss retry', async () => {
    const logger = recordingLogger();
    const failing = {
      execute: async () => {
        throw new PaymentGatewayError('UNAVAILABLE', 'refund');
      },
    };
    await expect(runRefundPayment(failing, PAYMENT_ID, logger)).rejects.toBeInstanceOf(PaymentGatewayError);
    expect(logger.lines).toEqual([
      expect.objectContaining({ level: 'warn', obj: expect.objectContaining({ paymentId: PAYMENT_ID }) }),
    ]);
  });

  it('cổng từ chối vĩnh viễn → log error (chỉ paymentId + loại lỗi), không throw', async () => {
    const logger = recordingLogger();
    const outcome = await runRefundPayment(
      runner(async () => ({ kind: 'GATEWAY_REJECTED', paymentId: PAYMENT_ID, gatewayErrorKind: 'REJECTED' })),
      PAYMENT_ID,
      logger,
    );
    expect(outcome.kind).toBe('GATEWAY_REJECTED');
    expect(logger.lines).toEqual([
      {
        level: 'error',
        obj: { job: 'billing.refund-payment', paymentId: PAYMENT_ID, gatewayErrorKind: 'REJECTED' },
        msg: expect.any(String),
      },
    ]);
  });

  it('Err nghiệp vụ → log error + throw', async () => {
    const logger = recordingLogger();
    const broken = { execute: async () => fail('PAYMENT_INVALID_TRANSITION') };
    await expect(runRefundPayment(broken, PAYMENT_ID, logger)).rejects.toThrow(/PAYMENT_INVALID_TRANSITION/);
    expect(logger.lines.map((l) => l.level)).toEqual(['error']);
  });
});

describe('dispatchPendingRefunds', () => {
  it('đẩy mỗi khoản REFUND_PENDING một lần; id job xác định theo payment', async () => {
    const sent: string[] = [];
    const count = await dispatchPendingRefunds(
      { execute: async () => [{ paymentId: PAYMENT_ID as never, refundRequestedAt: new Date() }] },
      async (id) => void sent.push(id),
    );
    expect(count).toBe(1);
    expect(sent).toEqual([PAYMENT_ID]);
    expect(refundPaymentJobId(PAYMENT_ID)).toBe(refundPaymentJobId(PAYMENT_ID));
  });
});

describe('checkRefundSla (AC3)', () => {
  it('mỗi khoản quá SLA → một dòng log mức error, không PII (chỉ paymentId + mốc thời gian)', async () => {
    const logger = recordingLogger();
    const requestedAt = new Date('2026-11-16T00:00:00.000Z');
    const count = await checkRefundSla(
      {
        execute: async () => [
          { paymentId: PAYMENT_ID as never, refundRequestedAt: requestedAt, hoursPending: 49 },
        ],
      },
      logger,
    );
    expect(count).toBe(1);
    expect(logger.lines).toEqual([
      {
        level: 'error',
        obj: {
          job: BILLING_REFUND_SLA_QUEUE,
          alert: 'refund_sla_breached',
          paymentId: PAYMENT_ID,
          refundRequestedAt: requestedAt.toISOString(),
          hoursPending: 49,
          slaHours: REFUND_SLA_HOURS,
        },
        msg: 'refund pending beyond SLA',
      },
    ]);
  });

  it('không có khoản quá hạn → không log', async () => {
    const logger = recordingLogger();
    expect(await checkRefundSla({ execute: async () => [] }, logger)).toBe(0);
    expect(logger.lines).toEqual([]);
  });
});
