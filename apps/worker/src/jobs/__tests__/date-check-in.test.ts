import type { JobLogger } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import type { CheckInOverduePayload, MarkCheckInOverdueOutcome } from '@tamgiao/module-dating';
import { describe, expect, it } from 'vitest';
import {
  parseCheckInOverduePayload,
  runCheckInLocationPurge,
  runCheckInOverdue,
  type CheckInLocationPurger,
  type CheckInOverdueMarker,
} from '../date-check-in.js';

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

function markerReturning(outcome: MarkCheckInOverdueOutcome) {
  const calls: CheckInOverduePayload[] = [];
  const marker: CheckInOverdueMarker = {
    executeIn: async (_tx, payload) => {
      calls.push(payload);
      return outcome;
    },
  };
  return { marker, calls };
}

describe('date check-in jobs (BE-S7-02)', () => {
  describe('check-in overdue job', () => {
    it('gọi MarkCheckInOverdue với checkInId và log kết quả (không PII)', async () => {
      const { marker, calls } = markerReturning({ kind: 'ALERTED' });
      const { logger, lines } = recordingLogger();
      const outcome = await runCheckInOverdue(marker, TX, { checkInId: 'c-1' }, logger);
      expect(outcome.kind).toBe('ALERTED');
      expect(calls).toEqual([{ checkInId: 'c-1' }]);
      expect(lines).toEqual([
        {
          level: 'info',
          obj: { job: 'dating.check-in-overdue', checkInId: 'c-1', kind: 'ALERTED' },
          msg: 'check-in overdue handled',
        },
      ]);
    });

    it('check-in không tồn tại → log warn, không throw', async () => {
      const { marker } = markerReturning({ kind: 'NOT_FOUND' });
      const { logger, lines } = recordingLogger();
      await runCheckInOverdue(marker, TX, { checkInId: 'c-2' }, logger);
      expect(lines.map((l) => l.level)).toEqual(['warn']);
    });

    it('payload thiếu checkInId → throw (retry / dead-letter)', () => {
      expect(() => parseCheckInOverduePayload({})).toThrow(/checkInId/);
      expect(() => parseCheckInOverduePayload({ checkInId: 1 })).toThrow(/checkInId/);
    });
  });

  describe('check-in location purge job', () => {
    it('gọi PurgeCheckInLocations và log số dòng đã xoá', async () => {
      let purgeCalled = false;
      const purger: CheckInLocationPurger = {
        executeIn: async () => {
          purgeCalled = true;
          return { purged: 3 };
        },
      };
      const { logger, lines } = recordingLogger();
      const outcome = await runCheckInLocationPurge(purger, TX, logger);
      expect(purgeCalled).toBe(true);
      expect(outcome.purged).toBe(3);
      expect(lines).toEqual([
        {
          level: 'info',
          obj: { job: 'dating.purge-check-in-locations', purged: 3 },
          msg: 'check-in locations purged',
        },
      ]);
    });
  });
});
