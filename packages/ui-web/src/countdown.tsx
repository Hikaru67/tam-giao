import { useEffect, useRef, type HTMLAttributes } from 'react';
import { useCountdown } from '@tamgiao/ui-core';

export interface CountdownProps extends HTMLAttributes<HTMLSpanElement> {
  expiresAt: string | Date;
  onExpire?: () => void;
  prefixText?: string;
}

export function Countdown({ expiresAt, onExpire, prefixText, className = '', ...rest }: CountdownProps) {
  const { formatted, expired } = useCountdown(expiresAt);
  const onExpireCalledRef = useRef(false);

  useEffect(() => {
    if (expired && !onExpireCalledRef.current) {
      onExpireCalledRef.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);

  return (
    <span aria-live="polite" className={`font-semibold text-primary ${className}`.trim()} {...rest}>
      {prefixText ? <span>{prefixText} </span> : null}
      <span>{formatted}</span>
    </span>
  );
}
