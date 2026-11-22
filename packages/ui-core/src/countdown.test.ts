import { describe, expect, it } from 'vitest';
import { formatCountdown, remainingMs } from './countdown.js';

describe('countdown core', () => {
  it('remainingMs tính đúng và không âm khi đã quá hạn', () => {
    const now = new Date('2026-11-22T10:00:00Z');
    const future = new Date('2026-11-22T10:05:00Z');
    const past = new Date('2026-11-22T09:55:00Z');

    expect(remainingMs(future, now)).toBe(5 * 60 * 1000);
    expect(remainingMs(past, now)).toBe(0);
    expect(remainingMs(future.toISOString(), now)).toBe(5 * 60 * 1000);
  });

  it('formatCountdown định dạng MM:SS khi < 1 giờ', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(26_000)).toBe('00:26');
    expect(formatCountdown(5 * 60 * 1000 + 9 * 1000)).toBe('05:09');
    expect(formatCountdown(59 * 60 * 1000 + 59 * 1000)).toBe('59:59');
  });

  it('formatCountdown định dạng HH:MM:SS khi >= 1 giờ', () => {
    expect(formatCountdown(3_600_000)).toBe('01:00:00');
    expect(formatCountdown(3_665_000)).toBe('01:01:05');
    expect(formatCountdown(24 * 3_600_000)).toBe('24:00:00');
  });
});
