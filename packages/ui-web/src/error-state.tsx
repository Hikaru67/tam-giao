import { Button } from './button.js';

export interface ErrorStateProps {
  title: string;
  action?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title, action = 'Thử lại', onRetry, className = '' }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center text-center p-space-xl gap-space-sm ${className}`.trim()}
    >
      <div
        className="w-16 h-16 rounded-full bg-error-container text-on-error-container flex items-center justify-center text-headline-md font-bold mb-space-xs"
        aria-hidden="true"
      >
        !
      </div>
      <h3 className="text-title-md font-bold text-error">{title}</h3>
      {onRetry ? (
        <div className="mt-space-sm">
          <Button variant="danger" size="md" onClick={onRetry}>
            {action}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
