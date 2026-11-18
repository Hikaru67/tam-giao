import type { JobLogger } from '@tamgiao/db';
import type { Id } from '@tamgiao/kernel';
import type { KycMediaPurgeSummary } from '@tamgiao/module-verification';
import { describe, expect, it } from 'vitest';
import { runKycMediaRetention } from '../kyc-media-retention.js';

class RecordingLogger implements JobLogger {
  lines: { level: string; obj: object; msg: string }[] = [];
  info(obj: object, msg: string): void {
    this.lines.push({ level: 'info', obj, msg });
  }
  warn(obj: object, msg: string): void {
    this.lines.push({ level: 'warn', obj, msg });
  }
  error(obj: object, msg: string): void {
    this.lines.push({ level: 'error', obj, msg });
  }
}

const purger = (summary: KycMediaPurgeSummary) => ({ execute: async () => summary });

describe('runKycMediaRetention', () => {
  it('ghi log số đếm, không throw khi không có lỗi', async () => {
    const logger = new RecordingLogger();
    await runKycMediaRetention(purger({ purged: 2, skipped: 1, failedIds: [] }), logger);
    expect(logger.lines).toEqual([
      {
        level: 'info',
        obj: { job: 'verification.kyc-media-retention', purged: 2, skipped: 1, failed: 0 },
        msg: 'kyc media retention finished',
      },
    ]);
  });

  it('có hồ sơ lỗi → throw để pg-boss thử lại', async () => {
    const logger = new RecordingLogger();
    await expect(
      runKycMediaRetention(
        purger({ purged: 1, skipped: 0, failedIds: ['id-1' as Id<'KycSubmission'>] }),
        logger,
      ),
    ).rejects.toThrow('1 submission(s) failed');
    expect(logger.lines.map((l) => l.level)).toEqual(['info', 'warn']);
  });
});
