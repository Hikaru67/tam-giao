import type { JobLogger } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import type { DatePlanExpiryPayload, ExpireDatePlanOutcome } from '@tamgiao/module-dating';
import { describe, expect, it } from 'vitest';
import { parseDatePlanExpiryPayload, runDatePlanExpiry, type DatePlanExpirer } from '../date-plan-expiry.js';

const TX = {} as Tx;

function recordingLogger() {
  const lines: { level: string; obj: object; msg: string }[] = [];
  const logger: JobLogger = {
    info: (obj, msg) => lines.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => lines.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => lines.push({ level: 'error', obj, msg }),
  };
  return { logger, lines };
}

function expirerReturning(outcome: ExpireDatePlanOutcome) {
  const calls: DatePlanExpiryPayload[] = [];
  const expirer: DatePlanExpirer = {
    executeIn: async (_tx, payload) => {
      calls.push(payload);
      return outcome;
    },
  };
  return { expirer, calls };
}

describe('date plan expiry job (BE-S7-01)', () => {
  it('gọi ExpireDatePlan với datePlanId và log kết quả (không PII)', async () => {
    const { expirer, calls } = expirerReturning({ kind: 'EXPIRED' });
    const { logger, lines } = recordingLogger();
    const outcome = await runDatePlanExpiry(expirer, TX, { datePlanId: 'd-1' }, logger);
    expect(outcome.kind).toBe('EXPIRED');
    expect(calls).toEqual([{ datePlanId: 'd-1' }]);
    expect(lines).toEqual([
      {
        level: 'info',
        obj: { job: 'dating.expire-date-plan', datePlanId: 'd-1', kind: 'EXPIRED' },
        msg: 'date plan expiry handled',
      },
    ]);
  });

  it('lịch không tồn tại → log warn, không throw', async () => {
    const { expirer } = expirerReturning({ kind: 'NOT_FOUND' });
    const { logger, lines } = recordingLogger();
    await runDatePlanExpiry(expirer, TX, { datePlanId: 'd-2' }, logger);
    expect(lines.map((l) => l.level)).toEqual(['warn']);
  });

  it('payload thiếu datePlanId → throw (retry / dead-letter)', () => {
    expect(() => parseDatePlanExpiryPayload({})).toThrow(/datePlanId/);
    expect(() => parseDatePlanExpiryPayload({ datePlanId: 1 })).toThrow(/datePlanId/);
  });
});
