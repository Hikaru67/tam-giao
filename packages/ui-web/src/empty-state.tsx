import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center p-space-xl gap-space-sm ${className}`.trim()}
    >
      {icon ? (
        <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center text-secondary mb-space-xs text-headline-md">
          {icon}
        </div>
      ) : null}
      <h3 className="text-title-md font-bold text-on-surface">{title}</h3>
      {description ? <p className="text-body-md text-secondary max-w-sm">{description}</p> : null}
      {action ? <div className="mt-space-sm">{action}</div> : null}
    </div>
  );
}
