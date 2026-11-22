import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tính số mili-giây còn lại đến hạn từ thời điểm `now`.
 * Luôn trả về giá trị không âm (>= 0).
 */
export function remainingMs(expiresAt: string | Date, now: Date): number {
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return Math.max(0, expiry.getTime() - now.getTime());
}

/**
 * Định dạng thời gian đếm ngược:
 * - Khi >= 1 giờ (ms >= 3_600_000): "HH:MM:SS"
 * - Khi < 1 giờ: "MM:SS"
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num: number) => String(num).padStart(2, '0');

  if (ms >= 3_600_000) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export interface UseCountdownOptions {
  now?: () => Date;
  intervalMs?: number;
}

export interface UseCountdownResult {
  remainingMs: number;
  formatted: string;
  expired: boolean;
}

/**
 * Hook đếm ngược theo thời gian server (`expiresAt`).
 * Cập nhật mỗi giây, dọn dẹp interval khi unmount.
 */
export function useCountdown(expiresAt: string | Date, options?: UseCountdownOptions): UseCountdownResult {
  const intervalMs = options?.intervalMs ?? 1000;
  // Giữ hàm `now` trong ref: nếu đưa vào deps (hàm mới mỗi lần render) thì `calculate` đổi liên tục →
  // effect chạy lại → setState → render lại → vòng lặp vô hạn.
  const nowRef = useRef(options?.now);
  nowRef.current = options?.now;

  const calculate = useCallback((): UseCountdownResult => {
    const now = nowRef.current ? nowRef.current() : new Date();
    const ms = remainingMs(expiresAt, now);
    return {
      remainingMs: ms,
      formatted: formatCountdown(ms),
      expired: ms <= 0,
    };
  }, [expiresAt]);

  const [state, setState] = useState<UseCountdownResult>(calculate);

  useEffect(() => {
    setState(calculate());
    const timer = setInterval(() => {
      const next = calculate();
      setState(next);
      if (next.expired) {
        clearInterval(timer);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [calculate, intervalMs]);

  return state;
}
