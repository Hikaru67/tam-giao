import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-container-high text-on-surface',
  success: 'bg-secondary-container text-on-secondary-container',
  warning: 'bg-tertiary-fixed text-on-tertiary-fixed',
  danger: 'bg-error-container text-on-error-container',
  primary: 'bg-primary-fixed text-on-primary-fixed',
};

export function Badge({ tone = 'neutral', icon, children, className = '', ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-space-xs px-space-sm py-0.5 rounded-full text-label-sm font-semibold select-none ${toneClasses[tone]} ${className}`.trim()}
      {...rest}
    >
      {icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
      <span>{children}</span>
    </span>
  );
}
