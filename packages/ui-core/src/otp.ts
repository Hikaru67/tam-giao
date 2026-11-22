import { useCallback, useMemo, useRef, useState } from 'react';

export const OTP_LENGTH = 6;

/**
 * Lọc bỏ ký tự không phải số và cắt tối đa 6 chữ số.
 */
export function sanitizeOtp(input: string): string {
  return input.replace(/\D/g, '').slice(0, OTP_LENGTH);
}

export interface UseOtpInputResult {
  value: string;
  setValue: (next: string) => void;
  digits: string[];
  isComplete: boolean;
  clear: () => void;
}

/**
 * Hook quản lý trạng thái nhập OTP 6 chữ số.
 * Khi dán hoặc nhập đủ 6 chữ số sẽ gọi `onComplete` đúng một lần.
 */
export function useOtpInput(onComplete: (code: string) => void): UseOtpInputResult {
  const [value, setRawValue] = useState('');
  const lastCompletedCodeRef = useRef<string | null>(null);

  const setValue = useCallback(
    (input: string) => {
      const sanitized = sanitizeOtp(input);
      setRawValue(sanitized);

      if (sanitized.length === OTP_LENGTH && sanitized !== lastCompletedCodeRef.current) {
        lastCompletedCodeRef.current = sanitized;
        onComplete(sanitized);
      } else if (sanitized.length < OTP_LENGTH) {
        lastCompletedCodeRef.current = null;
      }
    },
    [onComplete],
  );

  const clear = useCallback(() => {
    setRawValue('');
    lastCompletedCodeRef.current = null;
  }, []);

  const digits = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; i < OTP_LENGTH; i++) {
      list.push(value[i] ?? '');
    }
    return list;
  }, [value]);

  return {
    value,
    setValue,
    digits,
    isComplete: value.length === OTP_LENGTH,
    clear,
  };
}
