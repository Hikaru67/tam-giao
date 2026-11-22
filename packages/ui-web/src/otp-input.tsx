import { useRef, type ClipboardEvent, type KeyboardEvent, type ChangeEvent } from 'react';
import { OTP_LENGTH, useOtpInput } from '@tamgiao/ui-core';

export interface OtpInputProps {
  onComplete: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: string;
  className?: string;
  'aria-label'?: string;
}

export function OtpInput({
  onComplete,
  disabled = false,
  autoFocus = false,
  error,
  className = '',
  'aria-label': ariaLabel = 'Mã xác thực OTP gồm 6 chữ số',
}: OtpInputProps) {
  const { value, setValue, digits } = useOtpInput(onComplete);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    setValue(pasted);
    const targetIndex = Math.min(OTP_LENGTH - 1, pasted.replace(/\D/g, '').length);
    inputRefs.current[targetIndex]?.focus();
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>, index: number) => {
    const char = e.target.value.replace(/\D/g, '').slice(-1);
    const chars = value.split('');
    chars[index] = char;
    const nextValue = chars.join('').slice(0, OTP_LENGTH);
    setValue(nextValue);

    if (char && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  return (
    <div className={`flex flex-col items-center gap-space-xs ${className}`.trim()}>
      <div
        role="group"
        aria-label={ariaLabel}
        className="flex items-center justify-center gap-space-xs sm:gap-space-sm"
      >
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={1}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            value={digit}
            onChange={(e) => handleChange(e, index)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            onPaste={handlePaste}
            aria-label={`Chữ số ${index + 1}`}
            aria-invalid={Boolean(error)}
            className={`w-12 h-14 text-center text-headline-md font-bold rounded-xl border bg-surface-container-lowest text-on-surface shadow-sm outline-none transition-all focus:ring-2 focus:ring-primary ${
              error ? 'border-error focus:border-error' : 'border-outline-variant focus:border-primary'
            } ${disabled ? 'opacity-50 cursor-not-allowed bg-surface-container-low' : ''}`.trim()}
          />
        ))}
      </div>
      {error ? <p className="text-body-sm text-error text-center">{error}</p> : null}
    </div>
  );
}
