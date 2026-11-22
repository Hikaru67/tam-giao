import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountdown } from './countdown.js';
import { useOtpInput } from './otp.js';

describe('ui-core hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('useCountdown', () => {
    it('cập nhật thời gian giảm dần và chuyển expired = true khi hết hạn', () => {
      const baseTime = new Date('2026-11-22T10:00:00Z');
      vi.setSystemTime(baseTime);

      const expiresAt = new Date('2026-11-22T10:00:03Z');
      const { result } = renderHook(() => useCountdown(expiresAt));

      expect(result.current.remainingMs).toBe(3000);
      expect(result.current.formatted).toBe('00:03');
      expect(result.current.expired).toBe(false);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.remainingMs).toBe(2000);
      expect(result.current.formatted).toBe('00:02');
      expect(result.current.expired).toBe(false);

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.remainingMs).toBe(0);
      expect(result.current.formatted).toBe('00:00');
      expect(result.current.expired).toBe(true);
    });
  });

  describe('useOtpInput', () => {
    it('gọi onComplete một lần khi dán chuỗi 6 số', () => {
      const onComplete = vi.fn();
      const { result } = renderHook(() => useOtpInput(onComplete));

      act(() => {
        result.current.setValue('842915');
      });

      expect(result.current.value).toBe('842915');
      expect(result.current.digits).toEqual(['8', '4', '2', '9', '1', '5']);
      expect(result.current.isComplete).toBe(true);
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith('842915');

      // Set lại cùng giá trị không kích hoạt lại onComplete
      act(() => {
        result.current.setValue('842915');
      });
      expect(onComplete).toHaveBeenCalledTimes(1);

      // Xoá và nhập lại
      act(() => {
        result.current.clear();
      });
      expect(result.current.value).toBe('');
      expect(result.current.digits).toEqual(['', '', '', '', '', '']);
      expect(result.current.isComplete).toBe(false);

      act(() => {
        result.current.setValue('123456');
      });
      expect(onComplete).toHaveBeenCalledTimes(2);
      expect(onComplete).toHaveBeenLastCalledWith('123456');
    });

    it('không gọi onComplete khi chưa đủ 6 số', () => {
      const onComplete = vi.fn();
      const { result } = renderHook(() => useOtpInput(onComplete));

      act(() => {
        result.current.setValue('123');
      });

      expect(result.current.isComplete).toBe(false);
      expect(result.current.digits).toEqual(['1', '2', '3', '', '', '']);
      expect(onComplete).not.toHaveBeenCalled();
    });
  });
});

describe('useCountdown — hồi quy vòng lặp render', () => {
  it('không render lại liên tục khi không truyền `now` hoặc truyền `now` inline', () => {
    vi.useFakeTimers();
    try {
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      let renders = 0;
      renderHook(() => {
        renders += 1;
        return useCountdown(expiresAt);
      });
      let inlineRenders = 0;
      renderHook(() => {
        inlineRenders += 1;
        return useCountdown(expiresAt, { now: () => new Date() });
      });
      // Mount + effect đầu: vài lần render; vòng lặp vô hạn sẽ vượt xa ngưỡng này (hoặc treo).
      expect(renders).toBeLessThan(5);
      expect(inlineRenders).toBeLessThan(5);
      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(renders).toBeLessThan(10);
      expect(inlineRenders).toBeLessThan(10);
    } finally {
      vi.useRealTimers();
    }
  });
});
