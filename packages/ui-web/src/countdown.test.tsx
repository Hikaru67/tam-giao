import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Countdown } from './countdown.js';

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hiển thị thời gian giảm dần và gọi onExpire đúng một lần', () => {
    const base = new Date('2026-11-22T10:00:00Z');
    vi.setSystemTime(base);

    const expiresAt = new Date('2026-11-22T10:00:02Z');
    const onExpire = vi.fn();

    render(<Countdown expiresAt={expiresAt} onExpire={onExpire} />);

    expect(screen.getByText('00:02')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('00:01')).toBeTruthy();
    expect(onExpire).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('00:00')).toBeTruthy();
    expect(onExpire).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
