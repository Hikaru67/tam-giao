import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`bg-surface-container-lowest text-on-surface rounded-xl p-space-md shadow-sm border border-surface-container-high ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}
