import { useId, type InputHTMLAttributes } from 'react';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function TextField({
  label,
  hint,
  error,
  id: explicitId,
  disabled,
  className = '',
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = explicitId ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className={`flex flex-col gap-space-xs w-full ${className}`.trim()}>
      {label ? (
        <label htmlFor={inputId} className="text-label-md font-medium text-on-surface">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        className={`w-full min-h-[44px] px-space-md py-space-xs rounded-md bg-surface-container-lowest text-on-surface text-body-md border transition-colors outline-none focus:ring-2 focus:ring-primary ${
          error
            ? 'border-error focus:border-error'
            : 'border-outline-variant hover:border-outline focus:border-primary'
        } ${disabled ? 'opacity-50 cursor-not-allowed bg-surface-container-low' : ''}`.trim()}
        {...rest}
      />
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
