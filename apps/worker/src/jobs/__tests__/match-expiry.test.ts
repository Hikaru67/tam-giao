import type { JobLogger } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import type { ExpireMatchOutcome, MatchExpiryPayload } from '@tamgiao/module-matching';
import { describe, expect, it } from 'vitest';
import { parseMatchExpiryPayload, runMatchExpiry, type MatchExpirer } from '../match-expiry.js';

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

function expirerReturning(outcome: ExpireMatchOutcome) {
  const calls: MatchExpiryPayload[] = [];
  const expirer: MatchExpirer = {
    executeIn: async (_tx, payload) => {
      calls.push(payload);
      return outcome;
    },
  };
  return { expirer, calls };
}

describe('match expiry job', () => {
  it('gọi ExpireMatch với matchId và log kết quả (không PII)', async () => {
    const { expirer, calls } = expirerReturning({ kind: 'EXPIRED', fromStatus: 'OFFERED' });
    const { logger, lines } = recordingLogger();
    const outcome = await runMatchExpiry(expirer, TX, { matchId: 'm-1' }, logger);
    expect(outcome.kind).toBe('EXPIRED');
    expect(calls).toEqual([{ matchId: 'm-1' }]);
    expect(lines).toEqual([
      {
        level: 'info',
        obj: { job: 'matching.expire-match', matchId: 'm-1', kind: 'EXPIRED', fromStatus: 'OFFERED' },
        msg: 'match expiry handled',
      },
    ]);
  });

  it('match không tồn tại → log warn, không throw', async () => {
    const { expirer } = expirerReturning({ kind: 'NOT_FOUND' });
    const { logger, lines } = recordingLogger();
    await runMatchExpiry(expirer, TX, { matchId: 'm-2' }, logger);
    expect(lines.map((l) => l.level)).toEqual(['warn']);
  });

  it('payload thiếu matchId → throw (retry / dead-letter)', () => {
    expect(() => parseMatchExpiryPayload({})).toThrow(/matchId/);
    expect(() => parseMatchExpiryPayload({ matchId: 1 })).toThrow(/matchId/);
  });
});
