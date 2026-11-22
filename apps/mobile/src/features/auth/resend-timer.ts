import { useCallback, useState } from 'react';
import { useCountdown } from '@tamgiao/ui-core';

export interface ResendTimerResult {
  secondsLeft: number;
  canResend: boolean;
  restart: (seconds: number) => void;
}

/**
 * Hook quản lý thời gian đếm ngược cho nút gửi lại mã OTP.
 * Tính expiresAt = now + seconds một lần duy nhất khi khởi tạo hoặc restart.
 */
export function useResendTimer(resendAfterSeconds: number): ResendTimerResult {
  const [expiry, setExpiry] = useState<Date>(() => new Date(Date.now() + resendAfterSeconds * 1000));
  const { remainingMs, expired } = useCountdown(expiry);

  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
  const canResend = expired || secondsLeft <= 0;

  const restart = useCallback((seconds: number) => {
    setExpiry(new Date(Date.now() + seconds * 1000));
  }, []);

  return {
    secondsLeft,
    canResend,
    restart,
  };
}
