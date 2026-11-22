import { useState, useId, type ChangeEvent } from 'react';
import { normalizeVnPhone } from '@tamgiao/ui-core';

export interface PhoneInputProps {
  label?: string;
  hint?: string;
  error?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onChangeE164?: (e164: string | null) => void;
  onChangeRaw?: (raw: string) => void;
}

export function PhoneInput({
  label,
  hint,
  error,
  id: explicitId,
  value,
  defaultValue = '',
  disabled = false,
  placeholder = '0912 345 678',
  className = '',
  onChangeE164,
  onChangeRaw,
}: PhoneInputProps) {
  const generatedId = useId();
  const inputId = explicitId ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentVal = value !== undefined ? value : internalValue;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (value === undefined) {
      setInternalValue(raw);
    }
    onChangeRaw?.(raw);
    const normalized = normalizeVnPhone(raw);
    onChangeE164?.(normalized);
  };

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className={`flex flex-col gap-space-xs w-full ${className}`.trim()}>
      {label ? (
        <label htmlFor={inputId} className="text-label-md font-medium text-on-surface">
          {label}
        </label>
      ) : null}
      <div
        className={`flex items-center rounded-md border bg-surface-container-lowest overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-primary ${
          error ? 'border-error' : 'border-outline-variant hover:border-outline focus-within:border-primary'
        } ${disabled ? 'opacity-50 cursor-not-allowed bg-surface-container-low' : ''}`.trim()}
      >
        <span
          className="flex items-center gap-space-xs px-space-md py-space-xs bg-surface-container text-on-surface text-label-md font-semibold border-r border-outline-variant select-none shrink-0"
          aria-hidden="true"
        >
          <span>🇻🇳</span>
          <span>+84</span>
        </span>
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          disabled={disabled}
          placeholder={placeholder}
          value={currentVal}
          onChange={handleChange}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          aria-label={label ?? 'Số điện thoại di động'}
          className="w-full min-h-[44px] px-space-md py-space-xs bg-transparent text-on-surface text-body-lg outline-none placeholder:text-secondary disabled:cursor-not-allowed"
        />
      </div>
      {error ? (
        <p id={errorId} className="text-body-sm text-error">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-body-sm text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
