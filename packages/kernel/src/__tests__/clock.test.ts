import { describe, expect, it } from 'vitest';
import { FakeClock, SystemClock, addDuration, durationToMs } from '../clock.js';

describe('Clock', () => {
  it('durationToMs cộng đủ các đơn vị', () => {
    expect(durationToMs({})).toBe(0);
    expect(durationToMs({ days: 1, hours: 1, minutes: 1, seconds: 1, milliseconds: 1 })).toBe(
      86_400_000 + 3_600_000 + 60_000 + 1_000 + 1,
    );
  });

  it('addDuration trả Date mới, không sửa Date gốc', () => {
    const base = new Date('2026-11-16T00:00:00.000Z');
    const next = addDuration(base, { days: 14 });
    expect(next.toISOString()).toBe('2026-11-30T00:00:00.000Z');
    expect(base.toISOString()).toBe('2026-11-16T00:00:00.000Z');
  });

  it('FakeClock: mặc định 2026-01-01, advance 24h đổi now() đúng', () => {
    const clock = new FakeClock();
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(clock.advance({ hours: 24 }).toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('FakeClock: set và không lộ tham chiếu nội bộ', () => {
    const start = new Date('2026-05-01T08:00:00.000Z');
    const clock = new FakeClock(start);
    start.setUTCFullYear(2000);
    const leaked = clock.now();
    leaked.setUTCFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-05-01T08:00:00.000Z');
    clock.set(new Date('2027-01-01T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('SystemClock trả thời gian hiện tại', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
