import type { JobLogger } from '@tamgiao/db';
import type { SendNotificationOutcome } from '@tamgiao/module-notification';
import { describe, expect, it } from 'vitest';
import { parseNotificationSendPayload, runNotificationSend } from '../notification-send.js';

const logs: { level: string; obj: object }[] = [];
const logger: JobLogger = {
  info: (obj) => void logs.push({ level: 'info', obj }),
  warn: (obj) => void logs.push({ level: 'warn', obj }),
  error: (obj) => void logs.push({ level: 'error', obj }),
};
const sender = (outcome: SendNotificationOutcome) => ({ execute: async () => outcome });

describe('job notification.send', () => {
  it('payload thiếu deliveryId → throw', () => {
    expect(() => parseNotificationSendPayload({})).toThrow('deliveryId');
    expect(parseNotificationSendPayload({ deliveryId: 'd1' })).toBe('d1');
  });

  it('SENT → log info chỉ id + kết quả', async () => {
    logs.length = 0;
    const outcome: SendNotificationOutcome = {
      kind: 'SENT',
      channel: 'PUSH',
      pushedDevices: 1,
      removedDevices: 0,
    };
    expect(await runNotificationSend(sender(outcome), { deliveryId: 'd1' }, logger)).toEqual(outcome);
    expect(logs).toEqual([
      { level: 'info', obj: { job: 'notification.send', deliveryId: 'd1', ...outcome } },
    ]);
  });

  it('NOT_DUE → throw để pg-boss thử lại; NOT_FOUND → warn', async () => {
    await expect(
      runNotificationSend(sender({ kind: 'NOT_DUE', sendAfter: new Date() }), { deliveryId: 'd1' }, logger),
    ).rejects.toThrow('chưa tới giờ');
    logs.length = 0;
    await runNotificationSend(sender({ kind: 'NOT_FOUND' }), { deliveryId: 'd2' }, logger);
    expect(logs.map((l) => l.level)).toEqual(['warn']);
  });
});
