import { FakeClock } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { NoopErrorReporter, type ErrorContext, type ErrorReporter } from '../error-reporter.js';
import {
  OutboxBacklogMonitor,
  isBacklogged,
  type MonitorLogger,
  type OutboxBacklog,
} from '../outbox-backlog-monitor.js';

class RecordingReporter implements ErrorReporter {
  readonly enabled = true;
  readonly messages: { message: string; level: string; context?: ErrorContext | undefined }[] = [];
  captureException(): void {}
  captureMessage(message: string, level: 'warning' | 'error', context?: ErrorContext): void {
    this.messages.push({ message, level, context });
  }
  async flush(): Promise<void> {}
}

function recordingLogger() {
  const lines: { level: string; msg: string; obj: object }[] = [];
  const logger: MonitorLogger = {
    error: (obj, msg) => void lines.push({ level: 'error', msg, obj }),
    warn: (obj, msg) => void lines.push({ level: 'warn', msg, obj }),
    info: (obj, msg) => void lines.push({ level: 'info', msg, obj }),
  };
  return { logger, lines };
}

const THRESHOLDS = { maxUnpublished: 100, maxAgeSeconds: 300 };

function setup(initial: OutboxBacklog = { unpublished: 0, oldestAgeSeconds: 0 }) {
  let backlog: OutboxBacklog | Error = initial;
  const clock = new FakeClock(new Date('2026-11-22T00:00:00Z'));
  const reporter = new RecordingReporter();
  const { logger, lines } = recordingLogger();
  const monitor = new OutboxBacklogMonitor({
    read: async () => {
      if (backlog instanceof Error) throw backlog;
      return backlog;
    },
    thresholds: THRESHOLDS,
    reporter,
    logger,
    clock,
    realertAfterMs: 15 * 60_000,
  });
  return { monitor, clock, reporter, lines, set: (b: OutboxBacklog | Error) => (backlog = b) };
}

describe('isBacklogged', () => {
  it('vượt ngưỡng số lượng HOẶC tuổi → true; đúng bằng ngưỡng → false', () => {
    expect(isBacklogged({ unpublished: 100, oldestAgeSeconds: 300 }, THRESHOLDS)).toBe(false);
    expect(isBacklogged({ unpublished: 101, oldestAgeSeconds: 0 }, THRESHOLDS)).toBe(true);
    expect(isBacklogged({ unpublished: 1, oldestAgeSeconds: 301 }, THRESHOLDS)).toBe(true);
  });
});

describe('OutboxBacklogMonitor', () => {
  it('dưới ngưỡng → ok, không cảnh báo', async () => {
    const { monitor, reporter, lines } = setup({ unpublished: 5, oldestAgeSeconds: 2 });
    expect(await monitor.check()).toEqual({ status: 'ok', backlog: { unpublished: 5, oldestAgeSeconds: 2 } });
    expect(reporter.messages).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('outbox tồn đọng > ngưỡng → log error + gửi cảnh báo (AC2)', async () => {
    const { monitor, reporter, lines } = setup({ unpublished: 250, oldestAgeSeconds: 42.4 });
    expect(await monitor.check()).toMatchObject({ status: 'alert', notified: true });
    const context = { unpublished: 250, oldestAgeSeconds: 42, maxUnpublished: 100, maxAgeSeconds: 300 };
    expect(reporter.messages).toEqual([
      { message: 'outbox backlog above threshold', level: 'warning', context },
    ]);
    expect(lines).toEqual([{ level: 'error', msg: 'outbox backlog above threshold', obj: context }]);
  });

  it('event cũ quá ngưỡng tuổi (relay kẹt) dù số lượng ít → cảnh báo', async () => {
    const { monitor, reporter } = setup({ unpublished: 3, oldestAgeSeconds: 900 });
    expect(await monitor.check()).toMatchObject({ status: 'alert', notified: true });
    expect(reporter.messages).toHaveLength(1);
  });

  it('vẫn tồn đọng → không spam; nhắc lại sau realertAfterMs; hết tồn đọng → recovered một lần', async () => {
    const { monitor, clock, reporter, lines, set } = setup({ unpublished: 500, oldestAgeSeconds: 10 });
    await monitor.check();
    clock.advance({ minutes: 5 });
    expect(await monitor.check()).toMatchObject({ status: 'alert', notified: false });
    clock.advance({ minutes: 10 });
    expect(await monitor.check()).toMatchObject({ status: 'alert', notified: true });
    expect(reporter.messages).toHaveLength(2);

    set({ unpublished: 0, oldestAgeSeconds: 0 });
    clock.advance({ minutes: 1 });
    expect(await monitor.check()).toMatchObject({ status: 'recovered' });
    expect(await monitor.check()).toMatchObject({ status: 'ok' });
    expect(lines.filter((l) => l.msg === 'outbox backlog recovered')).toEqual([
      {
        level: 'info',
        msg: 'outbox backlog recovered',
        obj: expect.objectContaining({ alertingForSeconds: 960 }),
      },
    ]);

    // Tồn đọng lại → cảnh báo ngay (chu kỳ mới).
    set({ unpublished: 101, oldestAgeSeconds: 0 });
    expect(await monitor.check()).toMatchObject({ status: 'alert', notified: true });
    expect(reporter.messages).toHaveLength(3);
  });

  it('lỗi đọc DB → status error, log warn, không throw, không cảnh báo tồn đọng', async () => {
    const { monitor, reporter, lines, set } = setup();
    set(new Error('db down'));
    expect(await monitor.check()).toEqual({ status: 'error' });
    expect(reporter.messages).toEqual([]);
    expect(lines.map((l) => l.level)).toEqual(['warn']);
  });

  it('reporter no-op (thiếu DSN) vẫn log error khi tồn đọng', async () => {
    const { logger, lines } = recordingLogger();
    const monitor = new OutboxBacklogMonitor({
      read: async () => ({ unpublished: 1_000, oldestAgeSeconds: 0 }),
      thresholds: THRESHOLDS,
      reporter: new NoopErrorReporter(),
      logger,
      clock: new FakeClock(new Date()),
    });
    expect(await monitor.check()).toMatchObject({ status: 'alert', notified: true });
    expect(lines[0]?.level).toBe('error');
  });
});
